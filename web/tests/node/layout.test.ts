import { describe, expect, it } from 'vitest'
import {
  addRefusal,
  closeLeaf,
  defaultArrangement,
  defaultLayout,
  gridArrangement,
  holdsMostLeaves,
  KIND_ORDER,
  LAYOUT_VERSION,
  type LayoutNode,
  leafExtents,
  leaves,
  MAX_TREE_LEAVES,
  MIN_PANE_FRACTION,
  MIN_VIEW_PX,
  MOVE_DIRECTIONS,
  MOVES_KEPT,
  type MoveDirection,
  type MoveStep,
  moveBack,
  moveLeaf,
  moveRefusal,
  parseLayout,
  parseTree,
  pressRefusal,
  recordMove,
  resize,
  SOURCE_LEAF,
  serializeLayout,
  setLeafKind,
  splitLeaf,
} from '../../src/layout'
import { DIVIDER_PX } from '../../src/layout-view'
import type { PaneKind } from '../../src/panes'
import { parseWorkspace, serializeWorkspace } from '../../src/workspace'
import { fourViews, fourViewWorkspace, leafOf, rowOfLeaves, sourceBeside } from '../browser/harness'

/** The four kinds the arrangements below were drawn for: every kind but CLIF, in `KIND_ORDER`. */
const FOUR: readonly PaneKind[] = ['source', 'lambda', 'rxm', 'tm']

/**
 * THE TREE MODEL, WITH NO DOM ANYWHERE — every invariant 5d-ii-a design §4.1 states, asserted as a value.
 *
 * The reason this tier exists at all is that a layout bug is invisible in a browser until it is
 * grotesque: a single-child split renders as a pane with slightly wrong padding, and sizes that do
 * not sum to 1 render as a gap. Both are values here.
 */

describe('defaultArrangement', () => {
  it('is the leaf for one kind, under its default id', () => {
    expect(defaultArrangement(['tm'], 'wide')).toEqual(leafOf('tm-0', 'tm'))
    expect(defaultArrangement(['source'], 'tall')).toEqual(leafOf('source', 'source'))
  })

  it('puts a pair side by side in a wide area and one above the other in a tall one', () => {
    expect(defaultArrangement(['source', 'rxm'], 'wide')).toEqual(sourceBeside('rxm-0', 'rxm', 'row'))
    expect(defaultArrangement(['source', 'rxm'], 'tall')).toEqual(sourceBeside('rxm-0', 'rxm', 'column'))
  })

  it('puts the first of three beside a column of the other two, and over a row of them in a tall area', () => {
    const three = (outer: 'row' | 'column', inner: 'row' | 'column'): LayoutNode => ({
      kind: 'split',
      dir: outer,
      sizes: [0.5, 0.5],
      children: [
        leafOf('source', 'source'),
        {
          kind: 'split',
          dir: inner,
          sizes: [0.5, 0.5],
          children: [leafOf('lambda-0', 'lambda'), leafOf('tm-0', 'tm')],
        },
      ],
    })
    expect(defaultArrangement(['source', 'lambda', 'tm'], 'wide')).toEqual(three('row', 'column'))
    expect(defaultArrangement(['source', 'lambda', 'tm'], 'tall')).toEqual(three('column', 'row'))
  })

  it('puts all four in two columns of two in a wide area: source over rxm, beside λ over TM', () => {
    expect(defaultArrangement(FOUR, 'wide')).toEqual({
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [
        {
          kind: 'split',
          dir: 'column',
          sizes: [0.5, 0.5],
          children: [leafOf('source', 'source'), leafOf('rxm-0', 'rxm')],
        },
        {
          kind: 'split',
          dir: 'column',
          sizes: [0.5, 0.5],
          children: [leafOf('lambda-0', 'lambda'), leafOf('tm-0', 'tm')],
        },
      ],
    })
  })

  it('puts all four in two rows of two in a tall area, the harness’s fourViews()', () => {
    expect(defaultArrangement(FOUR, 'tall')).toEqual(fourViews())
    expect(fourViews()).toEqual({
      kind: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [
        {
          kind: 'split',
          dir: 'row',
          sizes: [0.5, 0.5],
          children: [leafOf('source', 'source'), leafOf('lambda-0', 'lambda')],
        },
        {
          kind: 'split',
          dir: 'row',
          sizes: [0.5, 0.5],
          children: [leafOf('rxm-0', 'rxm'), leafOf('tm-0', 'tm')],
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
    const wide = defaultArrangement(FOUR, 'wide')
    const tall = defaultArrangement(FOUR, 'tall')
    const at = (t: LayoutNode, i: number, j: number): string => {
      const outer = t.kind === 'split' ? t.children[i] : undefined
      const inner = outer?.kind === 'split' ? outer.children[j] : undefined
      return inner?.kind === 'leaf' ? inner.id : ''
    }
    expect([at(wide, 0, 0), at(wide, 1, 0), at(wide, 0, 1), at(wide, 1, 1)]).toEqual([
      'source',
      'lambda-0',
      'rxm-0',
      'tm-0',
    ])
    expect([at(tall, 0, 0), at(tall, 0, 1), at(tall, 1, 0), at(tall, 1, 1)]).toEqual([
      'source',
      'lambda-0',
      'rxm-0',
      'tm-0',
    ])
  })

  it('lays the kinds out from KIND_ORDER whatever order they are handed in', () => {
    expect(defaultArrangement(['tm', 'source'], 'wide')).toEqual(defaultArrangement(['source', 'tm'], 'wide'))
    expect(defaultArrangement(['tm', 'rxm', 'lambda', 'source'], 'wide')).toEqual(defaultArrangement(FOUR, 'wide'))
    // A WIDE AREA'S LEAVES RUN DOWN EACH COLUMN IN TURN, and a tall one's are in `KIND_ORDER`. Spelled out and not read
    // from `HEADER_ORDER`: where a view sits in the grid is its own decision, so moving a toggle cannot move a view.
    expect(leaves(defaultArrangement(FOUR, 'wide')).map((l) => l.pane)).toEqual(['source', 'rxm', 'lambda', 'tm'])
    expect(leaves(defaultArrangement(FOUR, 'tall')).map((l) => l.pane)).toEqual([...FOUR])
  })

  it('makes a tree parseTree takes, holding the kinds asked, for every combination and both shapes', () => {
    for (let mask = 1; mask < 1 << KIND_ORDER.length; mask++) {
      const kinds = KIND_ORDER.filter((_, i) => (mask & (1 << i)) !== 0)
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
  })

  it('refuses no kinds, since a tree has a leaf or more', () => {
    expect(() => defaultArrangement([], 'wide')).toThrow(/a kind or more/)
  })
})

describe('gridArrangement', () => {
  const views = (n: number): LayoutNode[] => Array.from({ length: n }, (_, i) => leafOf(String(i), 'tm'))
  const linesOf = (tree: LayoutNode): string[][] =>
    tree.kind === 'split' ? tree.children.map((line) => leaves(line).map((l) => l.id)) : []

  // WRITTEN OUT AND NEVER COMPUTED WITH `gridLines`: a table read from the function under test agrees with any rule.
  it.each([
    [5, '0 / 1 3 / 2 4', '0 / 1 2 / 3 4'],
    [6, '0 3 / 1 4 / 2 5', '0 1 / 2 3 / 4 5'],
    [7, '0 3 / 1 4 / 2 5 6', '0 1 / 2 3 / 4 5 6'],
    [8, '0 3 / 1 4 6 / 2 5 7', '0 1 / 2 3 4 / 5 6 7'],
    [9, '0 3 6 / 1 4 7 / 2 5 8', '0 1 2 / 3 4 5 / 6 7 8'],
  ] as const)('arranges %i views by the rule, written out', (n, wide, tall) => {
    const written = (tree: LayoutNode): string =>
      linesOf(tree)
        .map((line) => line.join(' '))
        .join(' / ')
    expect(written(gridArrangement(views(n), 'wide'))).toBe(wide)
    expect(written(gridArrangement(views(n), 'tall'))).toBe(tall)
  })

  it('keeps every view once, along the long side, in lines one apart, in a tree parseTree takes', () => {
    for (let n = 5; n <= 9; n++) {
      for (const shape of ['wide', 'tall'] as const) {
        const tree = gridArrangement(views(n), shape)
        const label = `${n} views, ${shape}`
        const ids = leaves(tree).map((l) => l.id)
        expect([...ids].sort(), label).toEqual(views(n).flatMap((v) => (v.kind === 'leaf' ? [v.id] : [])))
        expect(tree.kind === 'split' && tree.dir, label).toBe(shape === 'wide' ? 'row' : 'column')
        const lengths = linesOf(tree).map((line) => line.length)
        expect(Math.max(...lengths) - Math.min(...lengths), label).toBeLessThanOrEqual(1)
        expect(parseTree(JSON.parse(JSON.stringify(tree))), label).toEqual(tree)
      }
    }
  })

  // `parseTree` ASKS ONLY THAT A SPLIT'S SIZES SUM TO 1, so it would take three lines at a half and two quarters.
  it('runs each line across the long side, and gives a split of k children 1/k each', () => {
    for (let n = 5; n <= 9; n++) {
      for (const shape of ['wide', 'tall'] as const) {
        const tree = gridArrangement(views(n), shape)
        if (tree.kind !== 'split') throw new Error(`${n} views make no split`)
        for (const split of [tree, ...tree.children]) {
          if (split.kind !== 'split') continue
          expect(split.sizes).toEqual(split.children.map(() => 1 / split.children.length))
          expect(split.dir).toBe((split === tree) === (shape === 'wide') ? 'row' : 'column')
        }
      }
    }
  })
})

describe('defaultLayout', () => {
  it('is the source beside the TM view, and one above the other in a tall area', () => {
    expect(defaultLayout('wide')).toEqual({
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leafOf('source', 'source'), leafOf('tm-0', 'tm')],
    })
    expect(defaultLayout('tall')).toEqual(defaultArrangement(['source', 'tm'], 'tall'))
  })
})

describe('splitLeaf', () => {
  it('replaces the leaf with a split holding it and a duplicate of its kind', () => {
    const tree = splitLeaf(leafOf('lambda-0', 'lambda'), 'lambda-0', 'row', 'lambda-1', 'lambda')
    expect(tree).toEqual({
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leafOf('lambda-0', 'lambda'), leafOf('lambda-1', 'lambda')],
    })
  })

  it('splits a nested leaf without disturbing its siblings', () => {
    const tree = splitLeaf(fourViews(), 'tm-0', 'column', 'tm-1', 'tm')
    expect(leaves(tree).map((l) => l.id)).toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0', 'tm-1'])
  })

  it('puts the new leaf right after its subject in leaves() order', () => {
    const next = splitLeaf(fourViews(), 'lambda-0', 'row', 'pane-1', 'tm')
    expect(leaves(next).map((l) => l.id)).toEqual(['source', 'lambda-0', 'pane-1', 'rxm-0', 'tm-0'])
  })

  it('refuses to split the source leaf, because there is no second editor to duplicate, saying the source pane cannot be split', () => {
    expect(() => splitLeaf(fourViews(), 'source', 'row', 'pane-1', 'lambda')).toThrow(/source pane cannot be split/)
  })

  it('throws on an unknown leaf rather than returning the tree unchanged', () => {
    expect(() => splitLeaf(fourViews(), 'nope', 'row', 'x', 'lambda')).toThrow(/nope/)
  })

  it('refuses a newId already in the tree, because the duplicate would be unreachable', () => {
    // findLeaf uses .find(), so a duplicate id would silently hide the second leaf behind the first
    // rather than surface as a tree `parseTree` could also reject on load.
    expect(() => splitLeaf(fourViews(), 'lambda-0', 'row', 'tm-0', 'lambda')).toThrow(/tm-0/)
  })
})

describe('closeLeaf', () => {
  it('collapses a split left with one child into that child', () => {
    const tree = splitLeaf(leafOf('lambda-0', 'lambda'), 'lambda-0', 'row', 'lambda-1', 'lambda')
    expect(closeLeaf(tree, 'lambda-1')).toEqual(leafOf('lambda-0', 'lambda'))
  })

  it('collapses recursively so no single-child spine survives', () => {
    // column[ row[source, lambda-0], row[rxm-0, tm-0] ] -> close source, close lambda-0 -> row[rxm-0, tm-0]
    const lower: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leafOf('rxm-0', 'rxm'), leafOf('tm-0', 'tm')],
    }
    const afterSource = closeLeaf(fourViews(), 'source')
    expect(afterSource).toEqual({
      kind: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [leafOf('lambda-0', 'lambda'), lower],
    })
    expect(closeLeaf(afterSource, 'lambda-0')).toEqual(lower)
  })

  it('refuses to close the last leaf', () => {
    expect(() => closeLeaf(leafOf('tm-0', 'tm'), 'tm-0')).toThrow(/last/)
  })

  it('renormalizes the sizes of the split it left', () => {
    const three: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.2, 0.3, 0.5],
      children: [leafOf('a', 'lambda'), leafOf('b', 'lambda'), leafOf('c', 'tm')],
    }
    const after = closeLeaf(three, 'b')
    expect(after.kind).toBe('split')
    if (after.kind !== 'split') throw new Error('unreachable')
    expect(after.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    // The survivors keep their RATIO: 0.2 : 0.5 becomes 0.2/0.7 : 0.5/0.7.
    expect(after.sizes[0]).toBeCloseTo(0.2 / 0.7, 10)
  })
})

/**
 * `moveLeaf` — the view layouts spec §9.2 and §14 item 3: the spec's table, and over every small tree that a move
 * gives a tree the loader takes with the same views in it, or `null`.
 */
describe('moveLeaf', () => {
  /** One letter a view, the table's own: S source, L λ, R rxm, T TM, C clif. R was A, for asm, in the spec. */
  const V: Readonly<Record<string, LayoutNode>> = {
    S: leafOf('source', 'source'),
    L: leafOf('lambda-0', 'lambda'),
    R: leafOf('rxm-0', 'rxm'),
    T: leafOf('tm-0', 'tm'),
    C: leafOf('clif-0', 'clif'),
  }
  const v = (letter: string): LayoutNode => {
    const node = V[letter]
    if (node === undefined) throw new Error(`no view ${letter}`)
    return node
  }
  const split =
    (dir: 'row' | 'column') =>
    (sizes: number[] | null, ...children: (LayoutNode | string)[]): LayoutNode => ({
      kind: 'split',
      dir,
      sizes: sizes ?? children.map(() => 1 / children.length),
      children: children.map((c) => (typeof c === 'string' ? v(c) : c)),
    })
  const row = split('row')
  const col = split('column')

  it.each<[string, LayoutNode, string, 'left' | 'right' | 'up' | 'down', LayoutNode | null]>([
    ['1', row(null, 'S', 'T'), 'T', 'left', row(null, 'T', 'S')],
    ['4', row(null, 'S', 'T'), 'T', 'down', col(null, 'S', 'T')],
    ['—', row(null, 'S', 'T'), 'T', 'right', null],
    [
      '3',
      row(null, col(null, 'S', 'R'), col(null, 'L', 'T')),
      'R',
      'right',
      row([0.25, 0.25, 0.5], 'S', 'R', col(null, 'L', 'T')),
    ],
    [
      '2',
      row(null, 'S', 'R', col(null, 'L', 'T')),
      'R',
      'right',
      row([1 / 3, 2 / 3], 'S', col([0.5, 0.25, 0.25], 'R', 'L', 'T')),
    ],
    [
      '4',
      row(null, col(null, 'S', 'R'), col(null, 'L', 'T')),
      'R',
      'down',
      col([0.75, 0.25], row([1 / 3, 2 / 3], 'S', col(null, 'L', 'T')), 'R'),
    ],
    ['3', col(null, 'S', row(null, 'L', 'T')), 'T', 'up', col([0.5, 0.25, 0.25], 'S', 'T', 'L')],
    ['4', col(null, 'S', row(null, 'L', 'T')), 'T', 'down', col([0.5, 0.25, 0.25], 'S', 'L', 'T')],
  ])('the spec table, case %s: %j moving %s %s', (_, tree, letter, direction, want) => {
    const got = moveLeaf(tree, leaves(v(letter))[0]?.id ?? '', direction)
    if (want === null) expect(got).toBeNull()
    else {
      expect(got).not.toBeNull()
      // SIZES TO THE FLOAT, NOT EXACTLY: a half of a third is not a third's half in binary.
      const flat = (n: LayoutNode): unknown =>
        n.kind === 'leaf'
          ? n.id
          : { dir: n.dir, sizes: n.sizes.map((x) => Math.round(x * 1e9)), c: n.children.map(flat) }
      expect(flat(got as LayoutNode)).toEqual(flat(want))
    }
  })

  /** Each view's share of the whole area, to the float. */
  const areas = (t: LayoutNode): Record<string, number> =>
    Object.fromEntries(
      [...leafExtents(t, { width: 1, height: 1 }, 0)].map(([id, e]) => [
        id,
        Math.round(e.width * e.height * 1e9) / 1e9,
      ]),
    )

  /** Every view's area in `row[col[S, R], col[L, T]]`, the spec's own row for case 4 across the root. */
  const quarters = { source: 0.25, 'rxm-0': 0.25, 'lambda-0': 0.25, 'tm-0': 0.25 }

  /** `x` rounded as `areas` rounds a view's area. */
  const rounded = (x: number): number => Math.round(x * 1e9) / 1e9

  /**
   * **CASES 2, 3 AND 4 KEEP EVERY VIEW'S AREA** in the spec's rows: into the split beside it the view takes the share it
   * held as a strip across that split, out of a branch the share of the area it held there, and across the root that
   * share of the tree as a strip along the edge. Case 1 trades two slots, here of one size. A row that pins its areas
   * before the move pins them after it too.
   */
  it.each<[string, LayoutNode, string, MoveDirection, Record<string, number> | null, Record<string, number> | 'kept']>([
    ['1', row(null, 'S', 'T'), 'T', 'left', null, 'kept'],
    ['4', row(null, 'S', 'T'), 'T', 'down', { source: 0.5, 'tm-0': 0.5 }, 'kept'],
    ['3', row(null, col(null, 'S', 'R'), col(null, 'L', 'T')), 'R', 'right', null, 'kept'],
    [
      '2',
      row(null, 'S', 'R', col(null, 'L', 'T')),
      'R',
      'right',
      { source: rounded(1 / 3), 'rxm-0': rounded(1 / 3), 'lambda-0': rounded(1 / 6), 'tm-0': rounded(1 / 6) },
      'kept',
    ],
    ['2', row(null, 'S', col(null, 'L', 'T')), 'S', 'right', { source: 0.5, 'lambda-0': 0.25, 'tm-0': 0.25 }, 'kept'],
    ['4', row(null, col(null, 'S', 'R'), col(null, 'L', 'T')), 'R', 'down', quarters, 'kept'],
    ['3', col(null, 'S', row(null, 'L', 'T')), 'T', 'up', null, 'kept'],
    ['4', col(null, 'S', row(null, 'L', 'T')), 'T', 'down', { source: 0.5, 'lambda-0': 0.25, 'tm-0': 0.25 }, 'kept'],
    ['4', col(null, row(null, 'S', 'L'), 'T'), 'T', 'right', { source: 0.25, 'lambda-0': 0.25, 'tm-0': 0.5 }, 'kept'],
  ])('gives each view its area, case %s: %j moving %s %s', (_, tree, letter, direction, before, after) => {
    const got = moveLeaf(tree, leaves(v(letter))[0]?.id ?? '', direction)
    expect(got).not.toBeNull()
    if (before !== null) expect(areas(tree)).toEqual(before)
    expect(areas(got as LayoutNode)).toEqual(after === 'kept' ? areas(tree) : after)
  })

  it('takes the room of a view moved out of its branch from that branch, as much as it held there', () => {
    // UNEVEN, SO HALF THE BRANCH AND WHAT THE VIEW HELD DIFFER: R held 0.3 of a branch half the row wide.
    const tree = row(null, col([0.7, 0.3], 'S', 'R'), col(null, 'L', 'T'))
    const got = moveLeaf(tree, 'rxm-0', 'right') as LayoutNode
    expect(leaves(got).map((l) => l.id)).toEqual(['source', 'rxm-0', 'lambda-0', 'tm-0'])
    expect(areas(got)).toEqual(areas(tree))
  })

  it('keeps the area of a view moved from deep in its branch, and of every other view in the branch and out of it', () => {
    // R HELD A QUARTER OF ITS BRANCH, HALF OF `row[C, R]`: THAT ROW GIVES IT UP, NOT S, SO S IS A QUARTER STILL.
    const tree = row(null, col(null, 'S', row(null, 'C', 'R')), col(null, 'L', 'T'))
    const got = moveLeaf(tree, 'rxm-0', 'right') as LayoutNode
    expect(leaves(got).map((l) => l.id)).toEqual(['source', 'clif-0', 'rxm-0', 'lambda-0', 'tm-0'])
    expect(areas(tree)).toEqual({ source: 0.25, 'clif-0': 0.125, 'rxm-0': 0.125, 'lambda-0': 0.25, 'tm-0': 0.25 })
    expect(areas(got)).toEqual(areas(tree))
  })

  it('gives a view that joins the split beside it the share it held, and each view in that split its area', () => {
    expect(moveLeaf(row(null, 'S', col(null, 'L', 'T')), 'source', 'right')).toEqual(
      col([0.5, 0.25, 0.25], 'S', 'L', 'T'),
    )
    // UNEVEN, SO A HALF OF THE NEIGHBOUR OR AN EQUAL SHARE WOULD SHOW: S HELD 0.7 OF THE ROW, L AND T 0.4 AND 0.6 OF 0.3.
    const tree = row([0.7, 0.3], 'S', col([0.4, 0.6], 'L', 'T'))
    const right = moveLeaf(tree, 'source', 'right') as LayoutNode
    expect(leaves(right).map((l) => l.id)).toEqual(['source', 'lambda-0', 'tm-0'])
    expect(right.kind === 'split' && right.dir).toBe('column')
    expect(areas(right)).toEqual(areas(tree))
    const mirrored = row([0.3, 0.7], col([0.4, 0.6], 'L', 'T'), 'S')
    const left = moveLeaf(mirrored, 'source', 'left') as LayoutNode
    expect(leaves(left).map((l) => l.id)).toEqual(['lambda-0', 'tm-0', 'source'])
    expect(areas(left)).toEqual(areas(mirrored))
  })

  it('keeps each slot its size when two views trade places', () => {
    const tree = row([0.7, 0.3], 'S', 'T')
    expect(moveLeaf(tree, 'tm-0', 'left')).toEqual(row([0.7, 0.3], 'T', 'S'))
  })

  it('leaves a view that is the whole tree where it is, in every direction', () => {
    for (const d of MOVE_DIRECTIONS) expect(moveLeaf(v('L'), 'lambda-0', d)).toBeNull()
  })

  it('gives a view across a root the share of the tree it held, and splices in a row it leaves behind', () => {
    // CASE 4 ASKS THE ROOT AS IT WAS, A COLUMN, AND T HELD HALF OF IT, SO T AND WHAT IS LEFT ARE A HALF EACH; WHAT IS
    // LEFT IS `row[S, L]`, WHICH THE FLATTENING SPLICES INTO THE NEW ROW, EACH OF S AND L KEEPING A QUARTER.
    const tree = col(null, row(null, 'S', 'L'), 'T')
    expect(moveLeaf(tree, 'tm-0', 'right')).toEqual(row([0.25, 0.25, 0.5], 'S', 'L', 'T'))
  })

  it('finds the edge through a split in a split of its own direction, as the screen shows it', () => {
    // `closeLeaf` LEAVES SUCH TREES: S is at the top of the column, though the tree puts its column inside one.
    const tree = col([0.5, 0.5], col([0.25, 0.75], 'S', 'L'), 'T')
    expect(moveLeaf(tree, 'source', 'up')).toBeNull()
    expect(moveLeaf(tree, 'source', 'down')).toEqual(col([0.125, 0.375, 0.5], 'L', 'S', 'T'))
  })

  it('answers no split in a split of its own direction where a join would leave one', () => {
    // CASE 2 OUT OF A ROW OF TWO LEAVES ITS COLUMN ALONE IN THE COLUMN ABOVE IT.
    const tree = col(null, row(null, 'S', col(null, 'L', 'R')), 'T')
    expect(moveLeaf(tree, 'source', 'right')).toEqual(col([0.25, 0.125, 0.125, 0.5], 'S', 'L', 'R', 'T'))
  })

  it('throws on a view the tree does not hold', () => {
    expect(() => moveLeaf(row(null, 'S', 'T'), 'nope', 'left')).toThrow(/nope/)
  })

  /**
   * `moveRefusal` — the view layouts spec §9.3: `moveLeaf`'s `null` said as alone or edge, and `addRefusal`'s floor
   * asked of the tree a move makes. (h − 12) / 2 is 160 at 332 px, `DIVIDER_PX` being 12.
   */
  describe('the floor on a move', () => {
    const roomy = { width: 1280, height: 800 }

    it('says a lone view is alone, a view at the edge is at the edge, and lets a move with room go', () => {
      for (const d of MOVE_DIRECTIONS) expect(moveRefusal(v('L'), 'lambda-0', d, roomy, DIVIDER_PX)).toBe('alone')
      expect(moveRefusal(row(null, 'S', 'T'), 'tm-0', 'right', roomy, DIVIDER_PX)).toBe('edge')
      expect(moveRefusal(row(null, 'S', 'T'), 'tm-0', 'left', roomy, DIVIDER_PX)).toBeNull()
    })

    it('refuses a move up or down that halves a view under the floor tall, and allows it at the floor', () => {
      const tree = row(null, 'S', 'T')
      expect(moveRefusal(tree, 'tm-0', 'down', { width: 1280, height: 332 }, DIVIDER_PX)).toBeNull()
      expect(moveRefusal(tree, 'tm-0', 'down', { width: 1280, height: 331.9 }, DIVIDER_PX)).toBe('short')
      expect(moveRefusal(tree, 'tm-0', 'up', { width: 1280, height: 331.9 }, DIVIDER_PX)).toBe('short')
      expect(moveRefusal(tree, 'tm-0', 'left', { width: 1280, height: 331.9 }, DIVIDER_PX)).toBeNull()
    })

    it('refuses a move sideways that halves a view under the floor wide, and allows it at the floor', () => {
      const tree = col(null, 'S', 'T')
      expect(moveRefusal(tree, 'tm-0', 'right', { width: 332, height: 800 }, DIVIDER_PX)).toBeNull()
      expect(moveRefusal(tree, 'tm-0', 'right', { width: 331.9, height: 800 }, DIVIDER_PX)).toBe('narrow')
    })

    it('refuses a move across the root whose strip would come out under the floor tall, and allows it at the floor', () => {
      // R DOWN IS A STRIP A QUARTER OF THE TREE DEEP: (h − 12) / 4 is 160 at 652 px, `DIVIDER_PX` being 12.
      const tree = row(null, col(null, 'S', 'R'), col(null, 'L', 'T'))
      const area = { width: 1280, height: 652 }
      const moved = moveLeaf(tree, 'rxm-0', 'down') as LayoutNode
      expect(leafExtents(moved, area, DIVIDER_PX).get('rxm-0')).toEqual({ width: 1280, height: 160 })
      expect(moveRefusal(tree, 'rxm-0', 'down', area, DIVIDER_PX)).toBeNull()
      expect(moveRefusal(tree, 'rxm-0', 'down', { width: 1280, height: 651.9 }, DIVIDER_PX)).toBe('short')
    })

    it('holds a move sideways into a column to height, though every view keeps its area', () => {
      // R RIGHT MAKES col[L, T] TWICE AS WIDE AND TAKES HALF OF IT, SO L KEEPS ITS AREA AT HALF ITS HEIGHT: a quarter of
      // the height less two dividers, 160 at 664 px.
      const tree = row(null, 'S', 'R', col(null, 'L', 'T'))
      const area = { width: 1280, height: 664 }
      const moved = moveLeaf(tree, 'rxm-0', 'right') as LayoutNode
      expect(areas(moved)).toEqual(areas(tree))
      expect(leafExtents(moved, area, DIVIDER_PX).get('lambda-0')?.height).toBe(160)
      expect(moveRefusal(tree, 'rxm-0', 'right', area, DIVIDER_PX)).toBeNull()
      expect(moveRefusal(tree, 'rxm-0', 'right', { width: 1280, height: 663.9 }, DIVIDER_PX)).toBe('short')
    })

    it('does not count a view whose share the move keeps, though a divider takes pixels from it', () => {
      // T UP TRADES PLACES WITH S, AND THE ANSWER IS FLATTENED: row[L, R] SPLICED INTO THE ROOT ADDS A DIVIDER TO IT,
      // WHICH TAKES 6 PX FROM S AND T, BOTH ALREADY UNDER THE FLOOR, WITH THEIR SHARES AS THEY WERE.
      const tree = row(null, col(null, 'S', 'T'), row(null, 'L', 'R'))
      const area = { width: 320, height: 800 }
      const before = leafExtents(tree, area, DIVIDER_PX).get('source')?.width ?? 0
      const after = leafExtents(moveLeaf(tree, 'tm-0', 'up') as LayoutNode, area, DIVIDER_PX).get('source')?.width
      expect([before, after]).toEqual([154, 148])
      expect(moveRefusal(tree, 'tm-0', 'up', area, DIVIDER_PX)).toBeNull()
    })
  })

  /**
   * Every tree of one to five views, every view and every direction (§14 item 3). The trees are built from the
   * views in one order: a move is about where a view stands, not which view it is.
   */
  it('gives a tree parseTree takes with the same views, or null, for every small tree, view and direction', () => {
    /** Every tree over `ids` in that order: a leaf, or a split of two runs or more along either axis. */
    const trees = (ids: readonly LayoutNode[]): LayoutNode[] => {
      if (ids.length === 1) return [ids[0] as LayoutNode]
      const out: LayoutNode[] = []
      /** Every way to cut `ids` into two runs or more. */
      const cuts = (from: number): LayoutNode[][][] => {
        if (from === ids.length) return [[]]
        const all: LayoutNode[][][] = []
        for (let to = from + 1; to <= ids.length; to++)
          for (const rest of cuts(to)) all.push([ids.slice(from, to), ...rest])
        return all
      }
      for (const runs of cuts(0)) {
        if (runs.length < 2) continue
        const each = runs.map(trees)
        const pick = (k: number): LayoutNode[][] =>
          k === each.length ? [[]] : (each[k] ?? []).flatMap((t) => pick(k + 1).map((r) => [t, ...r]))
        for (const children of pick(0))
          for (const dir of ['row', 'column'] as const) {
            // UNEVEN SHARES, so a size carried to the wrong slot shows.
            const weights = children.map((_, i) => i + 1)
            const total = weights.reduce((a, b) => a + b, 0)
            out.push({ kind: 'split', dir, children, sizes: weights.map((w) => w / total) })
          }
      }
      return out
    }
    const views = ['S', 'L', 'R', 'T', 'C'].map(v)
    const ids = (t: LayoutNode): string[] =>
      leaves(t)
        .map((l) => `${l.id}:${l.pane}`)
        .sort()
    /** Whether any split holds a split of its own direction. */
    const nested = (t: LayoutNode): boolean =>
      t.kind === 'split' && t.children.some((c) => (c.kind === 'split' && c.dir === t.dir) || nested(c))
    /** The tree as the screen orders it: no sizes, and a split's same-direction splits spliced into it. */
    const shape = (t: LayoutNode): unknown => {
      if (t.kind === 'leaf') return t.id
      const parts = t.children.flatMap((c) => {
        const inner = shape(c)
        return c.kind === 'split' && c.dir === t.dir ? (inner as { of: unknown[] }).of : [inner]
      })
      return { dir: t.dir, of: parts }
    }
    /** The split the view stands in as the screen draws it, and its place there. */
    const standing = (s: unknown, id: string): { dir: string; of: unknown[]; i: number } | null => {
      if (typeof s === 'string') return null
      const split = s as { dir: string; of: unknown[] }
      const i = split.of.indexOf(id)
      if (i >= 0) return { ...split, i }
      for (const c of split.of) {
        const found = standing(c, id)
        if (found !== null) return found
      }
      return null
    }
    /** Each view's share of the whole area, unrounded. */
    const shares = (t: LayoutNode): Record<string, number> =>
      Object.fromEntries([...leafExtents(t, { width: 1, height: 1 }, 0)].map(([id, e]) => [id, e.width * e.height]))
    /** The most any view's share in `a` differs from its share in `b`, over the views `a` holds. */
    const drift = (a: Record<string, number>, b: Record<string, number>): number =>
      Math.max(0, ...Object.entries(a).map(([id, s]) => Math.abs(s - (b[id] ?? Number.NaN))))
    const byCase = { kept: 0, traded: 0, joined: 0 }
    let moved = 0
    let refused = 0
    for (let n = 1; n <= views.length; n++)
      for (const tree of trees(views.slice(0, n)))
        for (const l of leaves(tree))
          for (const d of MOVE_DIRECTIONS) {
            const got = moveLeaf(tree, l.id, d)
            if (got === null) {
              refused++
              continue
            }
            moved++
            expect(parseTree(structuredClone(got)), JSON.stringify({ tree, id: l.id, d })).not.toBeNull()
            expect(ids(got)).toEqual(ids(tree))
            expect(got, JSON.stringify({ tree, id: l.id, d })).not.toEqual(tree)
            expect(nested(got), JSON.stringify({ tree, id: l.id, d })).toBe(false)
            // NOT A RESIZE: with sizes set aside, and each split in a split of its own direction spliced in, as the
            // screen draws them, the views stand otherwise than before.
            expect(shape(got), JSON.stringify({ tree, id: l.id, d })).not.toEqual(shape(tree))
            // THE AREAS, BY THE SPEC'S CASE: WHETHER THE VIEW HAS A NEIGHBOUR THAT WAY IN THE SPLIT IT STANDS IN.
            const stand = standing(shape(tree), l.id)
            const along = stand?.dir === (d === 'left' || d === 'right' ? 'row' : 'column')
            const beside = along ? stand?.of[(stand?.i ?? 0) + (d === 'right' || d === 'down' ? 1 : -1)] : undefined
            const was = shares(tree)
            const now = shares(got)
            if (typeof beside === 'string') {
              // CASE 1: THE TWO TRADE SLOTS, EACH SLOT KEEPING ITS SIZE, SO THEY TRADE AREAS AND NO OTHER VIEW'S CHANGES.
              byCase.traded++
              const traded = { ...was, [l.id]: was[beside] ?? 0, [beside]: was[l.id] ?? 0 }
              expect(drift(now, traded), JSON.stringify({ tree, id: l.id, d })).toBeLessThan(1e-9)
            } else {
              // CASES 2, 3 AND 4: INTO THE SPLIT BESIDE IT, OUT OF A BRANCH, OR TO THE EDGE OF THE TREE, AND EVERY VIEW
              // KEEPS ITS AREA.
              if (beside === undefined) byCase.kept++
              else byCase.joined++
              expect(drift(now, was), JSON.stringify({ tree, id: l.id, d })).toBeLessThan(1e-9)
            }
          }
    // THE SWEEP REACHED BOTH OUTCOMES, so neither half of the property passed by never being asked.
    expect(moved).toBeGreaterThan(1000)
    expect(refused).toBeGreaterThan(100)
    expect(Math.min(byCase.kept, byCase.traded, byCase.joined), JSON.stringify(byCase)).toBeGreaterThan(100)
  })

  /**
   * A MOVE STRAIGHT BACK — the view layouts spec §9.6: the same view moved the opposite way, on the tree the move left,
   * gives back the tree the move was made on, newest move first. `play` presses as `pane-host.ts`'s `move` does.
   */
  describe('moving back', () => {
    const BACK: Readonly<Record<MoveDirection, MoveDirection>> = {
      left: 'right',
      right: 'left',
      up: 'down',
      down: 'up',
    }
    type Press = readonly [id: string, direction: MoveDirection]

    /** The tree and the history after `presses` from `tree`, each a move back where the history has one. */
    const play = (
      tree: LayoutNode,
      presses: readonly Press[],
      history: readonly MoveStep[] = [],
    ): { tree: LayoutNode; history: readonly MoveStep[] } => {
      let t = tree
      let h = history
      for (const [id, d] of presses) {
        const back = moveBack(h, t, id, d)
        const next = back ?? moveLeaf(t, id, d)
        if (next === null) throw new Error(`${id} cannot move ${d}`)
        h = recordMove(h, t, id, d, next, back !== null)
        t = next
      }
      return { tree: t, history: h }
    }

    /** The tree to the float: a half of a third is not a third's half in binary. */
    const toFloat = (n: LayoutNode): unknown =>
      n.kind === 'leaf'
        ? n.id
        : { dir: n.dir, sizes: n.sizes.map((x) => Math.round(x * 1e9)), c: n.children.map(toFloat) }

    /** The whole-branch review's example: R at 0.3 of the column it shares with S, so a case 3 and a trade part. */
    const uneven = row(null, col([0.7, 0.3], 'S', 'R'), col(null, 'L', 'T'))

    it('puts back the tree a move was made on, where the same move the other way trades two slots', () => {
      const right = play(uneven, [['rxm-0', 'right']])
      expect(toFloat(right.tree)).toEqual(toFloat(row([0.35, 0.15, 0.5], 'S', 'R', col(null, 'L', 'T'))))
      expect(toFloat(moveLeaf(right.tree, 'rxm-0', 'left') as LayoutNode)).toEqual(
        toFloat(row([0.35, 0.15, 0.5], 'R', 'S', col(null, 'L', 'T'))),
      )
      const back = play(uneven, [
        ['rxm-0', 'right'],
        ['rxm-0', 'left'],
      ])
      expect(back.tree).toEqual(uneven)
      expect(back.history).toEqual([])
    })

    it('walks a chain of moves back, newest first', () => {
      const twice = play(uneven, [
        ['rxm-0', 'right'],
        ['rxm-0', 'right'],
      ])
      // THE SECOND PRESS IS A CASE 2: R JOINS THE COLUMN, AT ITS TOP.
      expect(toFloat(twice.tree)).toEqual(
        toFloat(row([0.35, 0.65], 'S', col([0.15 / 0.65, 0.25 / 0.65, 0.25 / 0.65], 'R', 'L', 'T'))),
      )
      expect(play(twice.tree, [['rxm-0', 'left']], twice.history).tree).toEqual(play(uneven, [['rxm-0', 'right']]).tree)
      const back = play(
        twice.tree,
        [
          ['rxm-0', 'left'],
          ['rxm-0', 'left'],
        ],
        twice.history,
      )
      expect(back.tree).toEqual(uneven)
      expect(back.history).toEqual([])
    })

    it('moves another view back first where it moved since, and the first view back after it', () => {
      const between = play(uneven, [
        ['rxm-0', 'right'],
        ['lambda-0', 'down'],
      ])
      // R LEFT IS NOT STRAIGHT BACK WHILE L'S MOVE IS THE NEWEST: TODAY'S MOVE, THE TRADE.
      const traded = play(between.tree, [['rxm-0', 'left']], between.history)
      expect(traded.tree).toEqual(moveLeaf(between.tree, 'rxm-0', 'left'))
      expect(traded.history).toHaveLength(3)
      const back = play(
        traded.tree,
        [
          ['rxm-0', 'right'],
          ['lambda-0', 'up'],
          ['rxm-0', 'left'],
        ],
        traded.history,
      )
      expect(back.tree).toEqual(uneven)
      expect(back.history).toEqual([])
    })

    it("makes the move today's, and forgets every step, where the layout changed otherwise since", () => {
      const right = play(uneven, [['rxm-0', 'right']])
      const changed: [string, LayoutNode][] = [
        ['a split', splitLeaf(right.tree, 'lambda-0', 'row', 'pane-9', 'clif')],
        ['a close', closeLeaf(right.tree, 'tm-0')],
        ['a divider drag', resize(right.tree, [], 0, 0.05)],
        ['a kind changed', setLeafKind(right.tree, 'lambda-0', 'clif')],
      ]
      for (const [what, tree] of changed) {
        expect(moveBack(right.history, tree, 'rxm-0', 'left'), what).toBeNull()
        const after = play(tree, [['rxm-0', 'left']], right.history)
        expect(after.tree, what).toEqual(moveLeaf(tree, 'rxm-0', 'left'))
        expect(after.history, what).toEqual([{ before: tree, after: after.tree, id: 'rxm-0', direction: 'left' }])
      }
    })

    it('finds the tree the move left by comparing, so the same tree built again keeps the step', () => {
      const right = play(uneven, [['rxm-0', 'right']])
      expect(play(structuredClone(right.tree), [['rxm-0', 'left']], right.history).tree).toEqual(uneven)
    })

    it("makes a move any other way, or of another view, today's move", () => {
      const right = play(uneven, [['rxm-0', 'right']])
      for (const d of ['right', 'up', 'down'] as const)
        expect(moveBack(right.history, right.tree, 'rxm-0', d), d).toBeNull()
      expect(moveBack(right.history, right.tree, 'lambda-0', 'left')).toBeNull()
      expect(moveBack([], right.tree, 'rxm-0', 'left')).toBeNull()
    })

    it(`keeps the newest ${MOVES_KEPT} moves, dropping the oldest`, () => {
      // T AND S TRADE PLACES BY TURNS, EACH PRESS ANOTHER VIEW'S THAN THE ONE BEFORE, SO NONE IS A MOVE BACK.
      const start = row(null, 'S', 'T')
      const presses = Array.from({ length: MOVES_KEPT + 1 }, (_, i): Press => [i % 2 === 0 ? 'tm-0' : 'source', 'left'])
      const all = play(start, presses)
      expect(MOVES_KEPT).toBe(64)
      expect(all.history).toHaveLength(MOVES_KEPT)
      expect(all.history[0]?.id).toBe('source')
      let t = all.tree
      let h = all.history
      while (h.length > 0) {
        const newest = h.at(-1) as MoveStep
        // EACH PRESS A MOVE BACK, WHICH TAKES A STEP OFF: ANY OTHER MOVE PUTS ONE ON, AND THE LOOP WOULD NOT END.
        expect(moveBack(h, t, newest.id, BACK[newest.direction]), `${h.length} steps left`).not.toBeNull()
        ;({ tree: t, history: h } = play(t, [[newest.id, BACK[newest.direction]]], h))
      }
      // BACK TO THE TREE THE FIRST PRESS LEFT, WHOSE STEP WAS DROPPED.
      expect(t).toEqual(row(null, 'T', 'S'))
    })

    it('refuses no move back, where the same move the other way is refused or the window was made smaller since', () => {
      expect(moveRefusal(uneven, 'rxm-0', 'right', { width: 1280, height: 800 }, DIVIDER_PX), 'precondition').toBeNull()
      const right = play(uneven, [['rxm-0', 'right']])
      // A WINDOW NARROWED SINCE THE MOVE: THE TRADE TAKES S TO 0.15 OF 1,000 PX LESS TWO DIVIDERS, 146.4 PX.
      const narrow = { width: 1000, height: 800 }
      expect(moveRefusal(right.tree, 'rxm-0', 'left', narrow, DIVIDER_PX)).toBe('narrow')
      expect(pressRefusal(right.history, right.tree, 'rxm-0', 'left', narrow, DIVIDER_PX)).toBeNull()
      // A WINDOW MADE SHORTER SINCE: R BACK AT 0.3 OF 400 PX LESS A DIVIDER IS 116.4 PX TALL, AS THAT WINDOW WOULD DRAW
      // IT HAD R NOT MOVED.
      const short = { width: 1280, height: 400 }
      expect(leafExtents(uneven, short, DIVIDER_PX).get('rxm-0')?.height, 'precondition').toBeLessThan(MIN_VIEW_PX)
      expect(pressRefusal(right.history, right.tree, 'rxm-0', 'left', short, DIVIDER_PX)).toBeNull()
      expect(play(right.tree, [['rxm-0', 'left']], right.history).tree).toEqual(uneven)
    })

    it('refuses no move back of a view under the floor before the move enlarged it, at the size the move was made at', () => {
      // R AT 0.3 OF 540 PX LESS A DIVIDER IS 158.4 PX TALL, AS A DIVIDER DRAG OR A SHORTER WINDOW CAN LEAVE IT.
      const area = { width: 1280, height: 540 }
      expect(leafExtents(uneven, area, DIVIDER_PX).get('rxm-0')?.height, 'precondition').toBeLessThan(MIN_VIEW_PX)
      expect(moveRefusal(uneven, 'rxm-0', 'right', area, DIVIDER_PX), 'precondition: the move').toBeNull()
      const right = play(uneven, [['rxm-0', 'right']])
      expect(pressRefusal(right.history, right.tree, 'rxm-0', 'left', area, DIVIDER_PX)).toBeNull()
      expect(play(right.tree, [['rxm-0', 'left']], right.history).tree).toEqual(uneven)
    })

    /**
     * EVERY MOVE MOVES BACK, IN EVERY CASE OF §9.2: seeded random trees of one to nine views, their shares uneven and
     * some splits in splits of their own direction, as `closeLeaf` leaves them; every view moved every way, and walks of
     * moves undone newest first.
     */
    it('puts back the tree of every move of a seeded sweep, one move at a time and a walk of them undone', () => {
      let seed = 20261128
      /** mulberry32: the same trees on every run. */
      const rnd = (): number => {
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      let made = 0
      const tree = (n: number): LayoutNode => {
        if (n === 1) {
          made++
          return leafOf(`v${made}`, KIND_ORDER[Math.floor(rnd() * KIND_ORDER.length)] as PaneKind)
        }
        const k = Math.min(n, 2 + Math.floor(rnd() * 3))
        const parts = Array.from({ length: k }, () => 1)
        for (let left = n - k; left > 0; left--) {
          const at = Math.floor(rnd() * k)
          parts[at] = (parts[at] ?? 0) + 1
        }
        const children = parts.map(tree)
        const weights = children.map(() => (rnd() < 0.3 ? 0.03 + rnd() * 0.1 : 0.2 + rnd()))
        const total = weights.reduce((a, b) => a + b, 0)
        return { kind: 'split', dir: rnd() < 0.5 ? 'row' : 'column', children, sizes: weights.map((w) => w / total) }
      }
      /** `t` with each split in a split of its own direction spliced in, as the screen draws it. */
      const flat = (t: LayoutNode): LayoutNode => {
        if (t.kind === 'leaf') return t
        const children: LayoutNode[] = []
        const sizes: number[] = []
        t.children.forEach((c, i) => {
          const f = flat(c)
          const share = t.sizes[i] ?? 0
          if (f.kind === 'split' && f.dir === t.dir) {
            children.push(...f.children)
            sizes.push(...f.sizes.map((s) => s * share))
          } else {
            children.push(f)
            sizes.push(share)
          }
        })
        return { ...t, children, sizes }
      }
      const pathOf = (t: LayoutNode, id: string): number[] | null => {
        if (t.kind === 'leaf') return t.id === id ? [] : null
        for (const [i, c] of t.children.entries()) {
          const p = pathOf(c, id)
          if (p !== null) return [i, ...p]
        }
        return null
      }
      const nodeAt = (t: LayoutNode, p: readonly number[]): LayoutNode =>
        p.reduce<LayoutNode>((n, i) => (n.kind === 'split' ? (n.children[i] as LayoutNode) : n), t)
      /** §9.2's case for `id` moved `d` in `t`, read off the table: `G`, `N` and how deep the leaf is under `G`. */
      const caseOf = (t: LayoutNode, id: string, d: MoveDirection): string => {
        const r = flat(t)
        const p = pathOf(r, id) ?? []
        const axis = d === 'left' || d === 'right' ? 'row' : 'column'
        const toward = d === 'right' || d === 'down' ? 1 : -1
        for (let depth = p.length - 1; depth >= 0; depth--) {
          const g = nodeAt(r, p.slice(0, depth))
          if (g.kind !== 'split' || g.dir !== axis) continue
          const n = g.children[(p[depth] ?? 0) + toward]
          if (n === undefined) continue
          if (depth === p.length - 1) return n.kind === 'leaf' ? '1' : '2'
          return '3'
        }
        return r.kind === 'split' && r.dir === axis ? '4 along' : '4 across'
      }

      const byCase: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4 along': 0, '4 across': 0 }
      /** Moves whose move the other way, made today, would not give back the tree. */
      let undoneOnlyBack = 0
      for (let trial = 0; trial < 400; trial++) {
        const t = tree(1 + Math.floor(rnd() * 9))
        for (const l of leaves(t))
          for (const d of MOVE_DIRECTIONS) {
            const got = moveLeaf(t, l.id, d)
            if (got === null) continue
            const kind = caseOf(t, l.id, d)
            byCase[kind] = (byCase[kind] ?? 0) + 1
            const what = JSON.stringify({ t, id: l.id, d })
            const h = recordMove([], t, l.id, d, got, false)
            expect(moveBack(h, got, l.id, BACK[d]), what).toEqual(t)
            for (const other of MOVE_DIRECTIONS)
              if (other !== BACK[d]) expect(moveBack(h, got, l.id, other), what).toBeNull()
            expect(recordMove(h, got, l.id, BACK[d], t, true), what).toEqual([])
            const today = moveLeaf(got, l.id, BACK[d])
            if (today === null || JSON.stringify(toFloat(today)) !== JSON.stringify(toFloat(flat(t)))) undoneOnlyBack++
          }
      }

      let walked = 0
      let backsOnTheWay = 0
      for (let w = 0; w < 200; w++) {
        const start = tree(2 + Math.floor(rnd() * 8))
        let t = start
        let h: readonly MoveStep[] = []
        // THE TREES THE WALK HAS STOOD ON, A MOVE BACK TAKING THE NEWEST OFF: WHAT EACH MOVE BACK MUST GIVE.
        const stood = [start]
        for (let s = 0; s < 30; s++) {
          const ls = leaves(t)
          const id = ls[Math.floor(rnd() * ls.length)]?.id ?? ''
          const d = MOVE_DIRECTIONS[Math.floor(rnd() * 4)] as MoveDirection
          const back = moveBack(h, t, id, d)
          const next = back ?? moveLeaf(t, id, d)
          if (next === null) continue
          if (back === null) stood.push(next)
          else {
            backsOnTheWay++
            stood.pop()
            expect(back).toEqual(stood.at(-1))
          }
          h = recordMove(h, t, id, d, next, back !== null)
          t = next
          walked++
        }
        while (h.length > 0) {
          const newest = h.at(-1) as MoveStep
          const back = moveBack(h, t, newest.id, BACK[newest.direction])
          expect(back, JSON.stringify({ start, newest })).not.toBeNull()
          h = recordMove(h, t, newest.id, BACK[newest.direction], back as LayoutNode, true)
          t = back as LayoutNode
        }
        expect(t).toEqual(start)
      }

      // EVERY CASE OF §9.2 ASKED, AND THE WALKS MET MOVES BACK ON THE WAY AS WELL AS AT THEIR ENDS.
      expect(Math.min(...Object.values(byCase)), JSON.stringify(byCase)).toBeGreaterThan(100)
      expect(undoneOnlyBack).toBeGreaterThan(100)
      expect(walked).toBeGreaterThan(3000)
      expect(backsOnTheWay).toBeGreaterThan(50)
    })
  })
})

describe('resize', () => {
  const pair: LayoutNode = {
    kind: 'split',
    dir: 'row',
    sizes: [0.5, 0.5],
    children: [leafOf('a', 'lambda'), leafOf('b', 'tm')],
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
   * most. Clamped anyway, the first would go to the floor and the second below nothing, a tree `parseTree` refuses, so
   * one arrow key on such a divider would store a workspace the next load throws away.
   *
   * **THE BOUNDS CROSS FROM A ROW OF 11, WHERE TWO SHARES TOGETHER ARE FIRST UNDER TWO FLOORS.** There a clamp would
   * take the first to the floor whichever way it was asked to move, shares of 0.1 and 0.0818, a tree the loader takes,
   * and move neither again. A guard that began at a row of 20, where the loader first refuses, would not stop that.
   */
  it.each([11, 21])(
    'leaves two neighbours alone where both cannot hold the minimum, in either direction: a row of %i',
    (views) => {
      const crowd: LayoutNode = {
        kind: 'split',
        dir: 'row',
        sizes: Array.from({ length: views }, () => 1 / views),
        children: [
          leafOf('source', 'source'),
          ...Array.from({ length: views - 1 }, (_, i) => leafOf(`pane-${i + 1}`, 'lambda')),
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
   * `path` over the same, unmutated `root` that `at()` already walked to completion at the top of
   * `resize`'s body. Every node `at()` stepped through on the way to the target was already
   * proven `kind === 'split'` (or `at()` itself would have thrown), and the target node itself is
   * proven `kind === 'split'` by the check immediately after `at()` returns — so by the time
   * `rewrite` runs, both of its own `kind !== 'split'` guards are checking something already
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
 * VALIDATION IS THE WORK HERE, NOT PARSING — 5d-ii-a design §4.4.
 *
 * `localStorage` is user-editable, so a value that passes a shallow shape check but violates 5d-ii-a
 * §4.1 crashes inside the renderer on load, which is strictly worse than falling back. Every malformed
 * value below is written by hand rather than mutated from a good one, because a hand-edited entry is
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
   * most one source leaf" and "the source leaf is `SOURCE_LEAF`" are not the same claim. `SOURCE_LEAF`'s
   * own doc says a source leaf under a fresh id "would be a different leaf as far as every one of those
   * is concerned — an empty pane beside a detached editor": `pane-host.ts`'s creation pass skips the
   * source kind (the editor's host is seeded before any layout exists), so `hostFor('foo', 'source')`
   * would mint an EMPTY `<section>` and the real editor would be left mounted in a host the tree no
   * longer names.
   *
   * ONE SOURCE LEAF UNDER THE WRONG ID, NOT TWO — a tree with `{id:'foo', pane:'source'}` and nothing
   * else of that kind passes the `sources > 1` count, which is exactly why counting is not enough.
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
   * A STORED RXM VIEW SURVIVES A RELOAD. A kind `validate` does not know fails the whole layout, and a layout that
   * fails is replaced by the default without a word, so an rxm view would be lost on every reload with nothing red.
   */
  it('accepts an rxm view in a stored tree', () => {
    const tree = {
      kind: 'split',
      dir: 'row',
      children: [
        { kind: 'leaf', id: SOURCE_LEAF, pane: 'source' },
        { kind: 'leaf', id: 'rxm-3', pane: 'rxm' },
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
  it('changes the kind and touches nothing else', () => {
    const next = setLeafKind(sourceBeside('a', 'lambda', 'row', [0.3, 0.7]), 'a', 'tm')
    expect(leaves(next).map((l) => [l.id, l.pane])).toEqual([
      ['source', 'source'],
      ['a', 'tm'],
    ])
    // The 5d-ii-b design's decision 1 is that the pane keeps its place: same shape, same sizes.
    expect(next).toMatchObject({ kind: 'split', dir: 'row', sizes: [0.3, 0.7] })
  })

  it('refuses source as a target even when the tree has no source leaf', () => {
    // The condition that lets the SPLIT MENU create a source pane is exactly the condition a reader
    // expects to unlock this. The 5d-ii-b design's decision 4 is why it does not: a pane never becomes
    // the source pane.
    const noSource: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leafOf('a', 'lambda'), leafOf('b', 'tm')],
    }
    expect(() => setLeafKind(noSource, 'a', 'source')).toThrow(/source/)
  })

  it('refuses to change the source leaf', () => {
    expect(() => setLeafKind(sourceBeside('a', 'lambda', 'row', [0.3, 0.7]), 'source', 'lambda')).toThrow(/source/)
  })

  it('refuses an id that is not in the tree', () => {
    expect(() => setLeafKind(sourceBeside('a', 'lambda', 'row', [0.3, 0.7]), 'nope', 'tm')).toThrow(/not in the tree/)
  })
})

describe('splitLeaf with an explicit kind', () => {
  it('creates a leaf of the requested kind, not the split leaf’s', () => {
    const next = splitLeaf(sourceBeside('a', 'lambda'), 'a', 'row', 'b', 'tm')
    expect(leaves(next).find((l) => l.id === 'b')?.pane).toBe('tm')
  })

  it('still refuses to split the source leaf, whatever kind is requested', () => {
    expect(() => splitLeaf(sourceBeside('a', 'lambda'), 'source', 'row', 'b', 'lambda')).toThrow(/source/)
  })

  it('refuses to create a second source leaf', () => {
    expect(() => splitLeaf(sourceBeside('a', 'lambda'), 'a', 'row', 'b', 'source')).toThrow(/source/)
  })

  it('creates a source leaf when the tree has none', () => {
    const noSource: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leafOf('a', 'lambda'), leafOf('b', 'tm')],
    }
    const next = splitLeaf(noSource, 'a', 'row', 'c', 'source')
    expect(leaves(next).find((l) => l.id === 'c')?.pane).toBe('source')
  })
})

/**
 * **NO ADD MAKES A VIEW SMALLER THAN `MIN_VIEW_PX`, AND NONE MAKES A TREE THE LOADER REFUSES.** Worked out from the
 * tree's fractions and the tiled area, so it needs no element: 1280×725.5 is `#views` at 1280×800 with no notice up,
 * where each of `fourViews()`'s views is 634×356.75.
 */
describe('the floor on an add', () => {
  const AREA = { width: 1280, height: 725.5 }
  const split = (root: LayoutNode, at: string, dir: 'row' | 'column') => (id: string) =>
    splitLeaf(root, at, dir, id, 'lambda')

  it('draws each view the size the stylesheet does', () => {
    const sizes = leafExtents(fourViews(), AREA, DIVIDER_PX)
    for (const id of ['source', 'lambda-0', 'rxm-0', 'tm-0'])
      expect(sizes.get(id)).toEqual({ width: 634, height: 356.75 })
  })

  it('refuses split right on a view under 332 px wide, and allows it at 332', () => {
    const narrow = splitLeaf(fourViews(), 'lambda-0', 'row', 'p2', 'lambda')
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
   * **A SPLIT DOWN IS HELD TO WIDTH TOO**: it makes a view as narrow as the one it halves. λ dragged to 0.12 of its
   * row is 152.16 px wide; split down, its halves are 172.375 px tall, which passes the height floor, and 152.16 wide,
   * which does not.
   */
  it('refuses a split down of a view already narrower than the floor', () => {
    const tree = resize(fourViews(), [0], 0, 0.38)
    expect(leafExtents(tree, AREA, DIVIDER_PX).get('lambda-0')?.width).toBeCloseTo(152.16, 9)
    const down = split(tree, 'lambda-0', 'column')
    expect(leafExtents(down('added'), AREA, DIVIDER_PX).get('added')).toEqual({ width: 152.16, height: 172.375 })
    expect(addRefusal(tree, down, 'height', AREA, DIVIDER_PX)).toBe('narrow')
  })

  it('does not count a view the add leaves alone, however narrow', () => {
    const squeezed: LayoutNode = {
      kind: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [
        leafOf('a', 'lambda'),
        { kind: 'split', dir: 'row', sizes: [0.9, 0.1], children: [leafOf('b', 'tm'), leafOf('c', 'tm')] },
      ],
    }
    expect(leafExtents(squeezed, AREA, DIVIDER_PX).get('c')?.width).toBeLessThan(MIN_VIEW_PX)
    expect(addRefusal(squeezed, split(squeezed, 'a', 'row'), 'width', AREA, DIVIDER_PX)).toBeNull()
  })

  it('refuses a 65th leaf as full, before room, and allows a 64th', () => {
    // WIDE ENOUGH THAT A 63RD OF IT HALVES TO THE FLOOR OR MORE, since a split halves the view it is chosen on.
    const wide = { width: 63 * 400, height: 800 }
    expect(MAX_TREE_LEAVES).toBe(64)
    expect([holdsMostLeaves(rowOfLeaves(63)), holdsMostLeaves(rowOfLeaves(64))]).toEqual([false, true])
    expect(addRefusal(rowOfLeaves(63), split(rowOfLeaves(63), 'pane-1', 'row'), 'width', wide, DIVIDER_PX)).toBeNull()
    expect(addRefusal(rowOfLeaves(64), split(rowOfLeaves(64), 'pane-1', 'row'), 'width', wide, DIVIDER_PX)).toBe('full')
    expect(addRefusal(rowOfLeaves(64), split(rowOfLeaves(64), 'pane-1', 'row'), 'width', AREA, DIVIDER_PX)).toBe('full')
  })

  it('changes nothing it was given', () => {
    const before = fourViews()
    const snapshot = structuredClone(before)
    addRefusal(before, split(before, 'lambda-0', 'row'), 'width', AREA, DIVIDER_PX)
    splitLeaf(before, 'lambda-0', 'row', 'pane-1', 'lambda')
    expect(before).toEqual(snapshot)
  })
})

describe('parseTree', () => {
  it('validates a bare tree the way parseLayout validates an envelope', () => {
    expect(parseTree(fourViews())).toEqual(fourViews())
    expect(parseTree({ kind: 'leaf', id: 'x', pane: 'source' })).toBeNull()
    expect(parseTree('nope')).toBeNull()
  })

  /** `source`, `lambda-0` and `pane-1`, a second λ view, in one row at a third each: a row no split writes. */
  const thirds = (): LayoutNode => ({
    kind: 'split',
    dir: 'row',
    sizes: [1 / 3, 1 / 3, 1 / 3],
    children: [leafOf('source', 'source'), leafOf('lambda-0', 'lambda'), leafOf('pane-1', 'lambda')],
  })
  const thirdsOverTwo = (): LayoutNode => ({
    kind: 'split',
    dir: 'column',
    sizes: [0.5, 0.5],
    children: [
      thirds(),
      { kind: 'split', dir: 'row', sizes: [0.5, 0.5], children: [leafOf('rxm-0', 'rxm'), leafOf('tm-0', 'tm')] },
    ],
  })

  /** A stored tree loads as written, though no gesture writes it: the remove-plus-view design's G4. */
  it('reads back a tree with two views of a kind in one row of equal shares, as stored', () => {
    expect(parseTree(thirdsOverTwo())).toEqual(thirdsOverTwo())
  })

  it('reads back a workspace whose tree and remembered arrangement hold it', () => {
    const ws = { ...fourViewWorkspace(), tree: thirdsOverTwo(), arrangements: { 'source+lambda': thirds() } }
    expect(parseWorkspace(serializeWorkspace(ws))).toEqual(ws)
  })
})

/**
 * **A TREE IS AT MOST 64 SPLITS DEEP AND HAS AT MOST 64 LEAVES** (Plan 7 part 6a spec §5.3, amended 2026-10-01), so a
 * link's tree and a stored one are held alike. Without them, a link of a few kilobytes could carry a tree that throws
 * out of `validate`'s recursion, or one that takes many seconds to open and is then stored.
 */
describe('the bound on a tree', () => {
  /**
   * A tree `depth` splits deep down each split's FIRST child, whose second child is a leaf. `validate` reads every
   * split before any leaf, so the leaf bound cannot stop the reading and only the depth bound can.
   */
  const spine = (depth: number): LayoutNode => {
    let node: LayoutNode = leafOf('pane-0', 'lambda')
    for (let i = 1; i <= depth; i++)
      node = { kind: 'split', dir: 'row', sizes: [0.5, 0.5], children: [node, leafOf(`pane-${i}`, 'lambda')] }
    return node
  }
  /** A tree `depth` splits deep down each split's SECOND child. */
  const trailing = (depth: number): LayoutNode => {
    let node: LayoutNode = leafOf(`pane-${depth}`, 'lambda')
    for (let i = depth - 1; i >= 0; i--)
      node = { kind: 'split', dir: 'row', sizes: [0.5, 0.5], children: [leafOf(`pane-${i}`, 'lambda'), node] }
    return node
  }
  /** Splits on the longest root-to-leaf path, and leaves. */
  const shape = (node: LayoutNode): { depth: number; leaves: number } => {
    if (node.kind === 'leaf') return { depth: 0, leaves: 1 }
    const kids = node.children.map(shape)
    return { depth: 1 + Math.max(...kids.map((k) => k.depth)), leaves: kids.reduce((n, k) => n + k.leaves, 0) }
  }

  it('accepts 64 leaves and refuses 65', () => {
    expect(parseTree(rowOfLeaves(64))).toEqual(rowOfLeaves(64))
    expect(parseTree(rowOfLeaves(65))).toBeNull()
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
    let node: unknown = leafOf('pane-0', 'lambda')
    for (let i = 10_000; i >= 1; i--) {
      const split = { dir: 'row', sizes: [0.5, 0.5], children: [node, leafOf(`pane-${i}`, 'lambda')] }
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
   * **A LEAF ID'S NUMBER IS ONE THE LEAF COUNTER CAN STEP PAST.** `main.ts`'s `seedLeafCounter` sets the counter one past
   * the largest number in the tree, as `leafNumber` reads it, and from 2^53 on adding one no longer moves it: the second
   * view added after such a tree would mint a duplicate id. Every form the app has minted parses: `source`; a default
   * arrangement's `lambda-0`, `rxm-0` and `tm-0`; `${leg}-${n}`; and `pane-${n}`. An id with no number cannot move the
   * counter, and parses.
   */
  it.each(['lambda-0', 'rxm-0', 'tm-0', 'lambda-3', 'tm-3', 'pane-1', 'pane-1000000000', 'a', 'lambda-x'])(
    'accepts the leaf id %s',
    (id) => {
      expect(parseTree(sourceBeside(id, 'lambda'))).toEqual(sourceBeside(id, 'lambda'))
    },
  )

  it.each(['pane-1000000001', 'pane-9007199254740991', 'pane-1e300', 'pane-0x1fffffffffffff', '1e300'])(
    'refuses the leaf id %s',
    (id) => {
      expect(parseTree(sourceBeside(id, 'lambda'))).toBeNull()
    },
  )
})
