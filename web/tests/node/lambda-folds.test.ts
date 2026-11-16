import { describe, expect, it, vi } from 'vitest'
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

/**
 * EXPAND ALL IS A MODE (the expand-all spec): every node but a chip defaults to open, the overrides still sit on top,
 * and it outlives what a new term clears. Every big subterm here is over `AUTO_FOLD_NODES` and holds no redex, so
 * the policy alone folds it — each test checks that first, or it could pass with the mode doing nothing.
 */
describe('Folds under expand all', () => {
  const big = wide(AUTO_FOLD_NODES)

  it('opens every subterm but a chip, and gives the policy back when it is turned off', () => {
    const t = new Tree(wireOf(`g (${big}) (\\f. \\x. f (f x))`))
    const bigNode = t.right(t.left(0))
    const chip = t.right(0)
    expect(t.chip(chip)).not.toBeNull()
    const f = new Folds()
    expect(f.isOpen(t, bigNode)).toBe(false)
    const v = f.version
    f.setExpandAll(true)
    expect(f.expandAll).toBe(true)
    expect(f.version).toBeGreaterThan(v)
    for (let i = 0; i < t.count; i += 1) expect(f.isOpen(t, i), `node ${i}`).toBe(t.chip(i) === null)
    f.setExpandAll(false)
    expect(f.expandAll).toBe(false)
    expect(f.isOpen(t, bigNode)).toBe(false)
  })

  it('still folds one node on a click, and opens a chip on one', () => {
    const t = new Tree(wireOf(`g (${big}) (\\f. \\x. f (f x))`))
    const bigNode = t.right(t.left(0))
    const inner = t.left(bigNode)
    const chip = t.right(0)
    const f = new Folds()
    f.setExpandAll(true)
    f.toggle(t, bigNode)
    expect(f.isOpen(t, bigNode)).toBe(false)
    expect(f.isOpen(t, inner), 'only the node clicked').toBe(true)
    f.toggle(t, chip)
    expect(f.isOpen(t, chip)).toBe(true)
  })

  it('opens what a step creates, dropping a fold the user made on the redex it replaced', () => {
    const before = new Tree(wireOf('k ((\\y. y) z)', { step: 1 }))
    const f = new Folds()
    f.advance(before)
    f.setExpandAll(true)
    f.toggle(before, before.right(0))
    expect(f.isOpen(before, before.right(0))).toBe(false)
    // Step 2 puts a big subterm where the redex was: the contractum, at the redex's path.
    const after = new Tree(wireOf(`k (${big})`, { step: 2, contractum: 2 }))
    expect(after.key(2)).toBe(before.key(before.right(0)))
    expect(autoOpen(after, 2), 'the policy would fold it').toBe(false)
    f.advance(after)
    expect(f.isOpen(after, 2)).toBe(true)
  })

  it('keeps every subterm open across a jump', () => {
    const f = new Folds()
    f.advance(new Tree(wireOf('k ((\\y. y) z)', { step: 1 })))
    f.setExpandAll(true)
    const later = new Tree(wireOf(`k (${big}) (${big})`, { step: 40, contractum: null }))
    f.advance(later)
    expect(autoOpen(later, later.right(0))).toBe(false)
    expect(f.isOpen(later, later.right(0))).toBe(true)
    expect(f.isOpen(later, later.right(later.left(0)))).toBe(true)
  })

  it('clears the overrides when it is turned on, so a node folded by hand opens too', () => {
    const t = new Tree(wireOf(`g (${big}) (a b)`))
    const small = t.right(0)
    const f = new Folds()
    f.toggle(t, small)
    expect(f.isOpen(t, small)).toBe(false)
    f.setExpandAll(true)
    expect(f.isOpen(t, small)).toBe(true)
  })

  it('is turned off by reset, which also clears the overrides', () => {
    const t = new Tree(wireOf(`g (${big}) (a b)`))
    const bigNode = t.right(t.left(0))
    const small = t.right(0)
    const f = new Folds()
    f.setExpandAll(true)
    f.toggle(t, small)
    f.reset()
    expect(f.expandAll).toBe(false)
    expect(f.isOpen(t, bigNode)).toBe(false)
    expect(f.isOpen(t, small)).toBe(true)
  })

  it('builds no path while there is no override, and looks one up again once there is', () => {
    const t = new Tree(wireOf(`g (${big}) (a b)`))
    const keys = vi.spyOn(t, 'key')
    const f = new Folds()
    f.setExpandAll(true)
    for (let i = 0; i < t.count; i += 1) f.isOpen(t, i)
    expect(keys).not.toHaveBeenCalled()
    f.toggle(t, t.right(0))
    keys.mockClear()
    expect(f.isOpen(t, t.right(0))).toBe(false)
    expect(keys).toHaveBeenCalled()
  })

  it('outlives a new term, which clears the overrides alone', () => {
    const t = new Tree(wireOf(`g (${big}) (a b)`))
    const small = t.right(0)
    const f = new Folds()
    f.setExpandAll(true)
    f.toggle(t, small)
    const v = f.version
    f.newTerm()
    expect(f.version).toBeGreaterThan(v)
    expect(f.expandAll).toBe(true)
    expect(f.isOpen(t, small), 'the fold made by hand is gone').toBe(true)
    expect(f.isOpen(t, t.right(t.left(0)))).toBe(true)
  })
})
