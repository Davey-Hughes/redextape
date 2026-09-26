import { describe, expect, it } from 'vitest'
import { KIND_ABS, KIND_APP, KIND_VAR, Tree } from '../../src/lambda-tree'
import { wireOf } from './tree-fixture'

describe('Tree', () => {
  // `(\x. x) y` in pre-order: 0 App, 1 Abs x, 2 Var x, 3 Var y.
  const t = new Tree(wireOf('(\\x. x) y'))

  it('derives parent, depth and size, and a subtree is one index range', () => {
    expect([...t.parent]).toEqual([-1, 0, 1, 0])
    expect([...t.depth]).toEqual([0, 1, 2, 1])
    expect([...t.size]).toEqual([4, 2, 1, 1])
    expect(t.maxDepth).toBe(2)
    expect([t.kind(0), t.kind(1), t.kind(2)]).toEqual([KIND_APP, KIND_ABS, KIND_VAR])
    expect(t.contains(1, 2)).toBe(true)
    expect(t.contains(1, 3)).toBe(false)
    expect(t.contains(0, 3)).toBe(true)
  })

  it('keys a node by its path, in the core Dir letters', () => {
    expect(t.key(0)).toBe('')
    expect(t.key(2)).toBe('LB')
    expect(t.key(3)).toBe('R')
  })

  /** A key is built on its nearest ancestor already keyed, so the order the keys are asked in must not matter. */
  it('keys every node by its path whichever node is asked first', () => {
    const src = '(\\f. \\x. f (f x)) (\\y. y y) (g (\\z. z (\\w. w)))'
    const path = (tree: Tree, i: number): string => {
      let k = ''
      for (let at = i; at > 0; at = tree.parent[at] as number) {
        const p = tree.parent[at] as number
        k = (tree.kind(p) === KIND_ABS ? 'B' : tree.left(p) === at ? 'L' : 'R') + k
      }
      return k
    }
    const reference = new Tree(wireOf(src))
    const n = reference.count
    const want = [...Array(n).keys()].map((i) => path(reference, i))
    const orders = {
      'root first': [...Array(n).keys()],
      'leaves first': [...Array(n).keys()].reverse(),
      scattered: [...Array(n).keys()].map((k) => (k * 7) % n),
    }
    for (const [name, order] of Object.entries(orders)) {
      expect(new Set(order).size, name).toBe(n)
      const tree = new Tree(wireOf(src))
      const keys = order.map((i) => tree.key(i))
      expect(keys, name).toEqual(order.map((i) => want[i]))
    }
  })

  it('finds the nearest linked ancestor, and every node linked to a construct', () => {
    const linked = new Tree(wireOf('(\\x. x x) y', { links: { 0: 7, 3: 9 } }))
    expect(linked.linkedAncestor(2)).toBe(7)
    expect(linked.linkedAncestor(3)).toBe(9)
    expect(linked.nodesLinkedTo(7)).toEqual([0])
    expect(new Tree(wireOf('x')).linkedAncestor(0)).toBeNull()
  })

  // A λ VIEW ASKS FOR THE PIN'S NODES MORE THAN ONCE A FRAME — to mark them, and to say whether there are
  // any — so a repeat is answered from the last walk, as the same array; another construct walks again.
  it('answers a repeated nodesLinkedTo from its last walk', () => {
    const linked = new Tree(wireOf('(\\x. x x) y', { links: { 0: 7, 2: 7 } }))
    const first = linked.nodesLinkedTo(7)
    expect(first).toEqual([0, 2])
    expect(linked.nodesLinkedTo(7), 'the repeat walked again').toBe(first)
    expect(linked.nodesLinkedTo(9)).toEqual([])
    expect(linked.nodesLinkedTo(7)).toEqual([0, 2])
  })

  it('reads numerals by structure and by their binders’ hints', () => {
    expect(new Tree(wireOf('\\f. \\x. f (f (f x))')).chip(0)).toEqual({ kind: 'numeral', value: 3 })
    expect(new Tree(wireOf('\\f. \\x. x')).chip(0)).toEqual({ kind: 'numeral', value: 0 })
    expect(new Tree(wireOf('\\a. \\b. a (a b)')).chip(0)).toBeNull()
    expect(new Tree(wireOf('\\f. \\x. f x x')).chip(0)).toBeNull()
    // A copy's hints are its printed names, freshened digits and all.
    expect(new Tree(wireOf('\\f0. \\x1. f0 x1')).chip(0)).toEqual({ kind: 'numeral', value: 1 })
    expect(new Tree(wireOf('\\t2. \\f0. f0')).chip(0)).toEqual({ kind: 'bool', value: false })
    expect(new Tree(wireOf('\\f. \\x. x f')).chip(0)).toBeNull()
  })

  it('reads booleans only under t and f binders — false and 0 are one term, told apart by hint', () => {
    expect(new Tree(wireOf('\\t. \\f. t')).chip(0)).toEqual({ kind: 'bool', value: true })
    expect(new Tree(wireOf('\\t. \\f. f')).chip(0)).toEqual({ kind: 'bool', value: false })
    expect(new Tree(wireOf('\\p. \\q. q')).chip(0)).toBeNull()
  })

  it('finds a chip inside a larger term', () => {
    const inner = new Tree(wireOf('g (\\f. \\x. f x)'))
    expect(inner.chip(2)).toEqual({ kind: 'numeral', value: 1 })
    expect(inner.chip(0)).toBeNull()
  })
})
