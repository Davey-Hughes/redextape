import { describe, expect, it } from 'vitest'
import { AUTO_FOLD_NODES, autoOpen, Folds } from '../../src/lambda-folds'
import { Tree } from '../../src/lambda-tree'
import { wireOf } from './tree-fixture'

/** `f x x … x` with `n` arguments: an application spine of `2n + 1` nodes. */
const wide = (n: number) => `f ${Array(n).fill('x').join(' ')}`

describe('autoOpen', () => {
  it('opens the root, anything holding the next redex, and anything small; closes chips', () => {
    const big = wide(AUTO_FOLD_NODES)
    const t = new Tree(wireOf(`g (${big}) ((\\y. y) z) (\\f. \\x. f x)`))
    const bigNode = t.right(t.left(t.left(0)))
    expect(t.size[bigNode]).toBeGreaterThan(AUTO_FOLD_NODES)
    expect(autoOpen(t, 0)).toBe(true)
    expect(autoOpen(t, bigNode)).toBe(false)
    const redexArg = t.right(t.left(0))
    expect(t.wire.nextRedex).toBe(redexArg)
    expect(autoOpen(t, redexArg)).toBe(true)
    expect(autoOpen(t, t.right(0))).toBe(false)
  })

  it('closes a chip even at the root, so a finished run reads as its value', () => {
    expect(autoOpen(new Tree(wireOf('\\f. \\x. f (f x)')), 0)).toBe(false)
    expect(autoOpen(new Tree(wireOf('\\y. y')), 0)).toBe(true)
  })

  it('opens a large subterm when the next redex is inside it', () => {
    const t = new Tree(wireOf(`g (${wide(AUTO_FOLD_NODES)} ((\\y. y) z))`))
    const arg = t.right(0)
    expect(t.size[arg]).toBeGreaterThan(AUTO_FOLD_NODES)
    expect(autoOpen(t, arg)).toBe(true)
  })
})

describe('Folds', () => {
  it('toggles against the automatic policy and bumps its version', () => {
    const t = new Tree(wireOf('g (a b) (c d)'))
    const f = new Folds()
    const v = f.version
    expect(f.isOpen(t, 1)).toBe(true)
    f.toggle(t, 1)
    expect(f.isOpen(t, 1)).toBe(false)
    expect(f.version).toBeGreaterThan(v)
    f.reset()
    expect(f.isOpen(t, 1)).toBe(true)
  })

  it('keeps an override across a step outside the redex and drops one inside it', () => {
    // Step 1: `k (a b) ((\y. y) (c d))` — the redex is the second argument, at path R.
    const before = new Tree(wireOf('k (a b) ((\\y. y) (c d))', { step: 1 }))
    const f = new Folds()
    f.advance(before)
    const outside = before.right(before.left(0))
    const inside = before.right(before.right(0))
    f.toggle(before, outside)
    f.toggle(before, inside)
    // Step 2 contracts it: `k (a b) (c d)`, the contractum (node 6) at the path the redex had.
    const after = new Tree(wireOf('k (a b) (c d)', { step: 2, contractum: 6 }))
    expect(after.key(6)).toBe(before.key(before.right(0)))
    f.advance(after)
    expect(f.isOpen(after, after.right(after.left(0)))).toBe(false)
    expect(after.key(after.right(6))).toBe(before.key(inside))
    expect(f.isOpen(after, after.right(6))).toBe(true)
  })

  it('reveals a node by opening every closed ancestor, and nothing else', () => {
    const t = new Tree(wireOf('g (a (b (c d))) (e f)'))
    const f = new Folds()
    const outer = t.right(t.left(0))
    const inner = t.right(outer)
    // `c d`: revealed, and folded itself — revealing a node shows it, folded or not, and does not open it.
    const node = t.right(inner)
    // `e f`: folded, and off the path.
    const off = t.right(0)
    for (const i of [outer, inner, node, off]) f.toggle(t, i)
    const path = new Set<number>()
    for (let at = t.parent[node] as number; at >= 0; at = t.parent[at] as number) path.add(at)
    const before = Array.from({ length: t.count }, (_, i) => f.isOpen(t, i))
    expect(before[outer]).toBe(false)
    const v = f.version
    f.reveal(t, node)
    for (const at of path) expect(f.isOpen(t, at), `ancestor ${at}`).toBe(true)
    for (let i = 0; i < t.count; i += 1) if (!path.has(i)) expect(f.isOpen(t, i), `node ${i}`).toBe(before[i])
    expect(f.version).toBeGreaterThan(v)
    f.reveal(t, node)
    expect(f.version).toBe(v + 1)
  })

  it('keeps every override across a jump, since it cannot know what the jump rewrote', () => {
    const t = new Tree(wireOf('k (a b) ((\\y. y) (c d))', { step: 1 }))
    const f = new Folds()
    f.advance(t)
    f.toggle(t, t.right(0))
    const later = new Tree(wireOf('k (a b) (c d)', { step: 9, contractum: 6 }))
    f.advance(later)
    expect(f.isOpen(later, 6)).toBe(false)
  })
})
