import { describe, expect, it, vi } from 'vitest'
import { LambdaTrees } from '../../src/lambda-trees'
import { LAMBDA_TREE_NODES, type LambdaTreeWire } from '../../src/protocol'

const wire = (step: number, refused: number | null = null): LambdaTreeWire => ({
  step,
  refused,
  kind: new Uint8Array([0]),
  left: new Uint32Array([0]),
  right: new Uint32Array([0]),
  name: new Uint32Array([0]),
  hint: new Uint32Array([0]),
  link: new Uint32Array([0xffff_ffff]),
  names: ['x'],
  nextRedex: null,
  contractum: null,
})

const client = (gen = 1) => ({ gen, awaitingRun: false, tree: vi.fn() })

describe('LambdaTrees', () => {
  it('asks once for a step and answers none until the tree arrives', () => {
    const c = client()
    const trees = new LambdaTrees(() => c)
    expect(trees.want('s', 5)).toEqual({ kind: 'none' })
    expect(trees.want('s', 5)).toEqual({ kind: 'none' })
    expect(c.tree).toHaveBeenCalledTimes(1)
    expect(c.tree).toHaveBeenCalledWith(5, LAMBDA_TREE_NODES)
    const t = wire(5)
    trees.store('s', 1, t)
    expect(trees.want('s', 5)).toEqual({ kind: 'tree', tree: t })
    expect(c.tree).toHaveBeenCalledTimes(1)
  })

  it('shows the last tree as stale while asking for a new step, one request in flight at a time', () => {
    const c = client()
    const trees = new LambdaTrees(() => c)
    trees.want('s', 5)
    const five = wire(5)
    trees.store('s', 1, five)
    expect(trees.want('s', 6)).toEqual({ kind: 'stale', tree: five })
    expect(trees.want('s', 7)).toEqual({ kind: 'stale', tree: five })
    expect(c.tree).toHaveBeenCalledTimes(2)
    expect(c.tree).toHaveBeenLastCalledWith(6, LAMBDA_TREE_NODES)
  })

  it('reports a refusal for the step it answers', () => {
    const c = client()
    const trees = new LambdaTrees(() => c)
    trees.want('s', 3)
    trees.store('s', 1, wire(3, 40_000))
    expect(trees.want('s', 3)).toEqual({ kind: 'refused', nodes: 40_000 })
  })

  it('takes a clamped answer as the answer to what it asked, so it does not ask again', () => {
    const c = client()
    const trees = new LambdaTrees(() => c)
    trees.want('s', 9)
    const clamped = wire(4)
    trees.store('s', 1, clamped)
    expect(trees.want('s', 9)).toEqual({ kind: 'tree', tree: clamped })
    expect(c.tree).toHaveBeenCalledTimes(1)
  })

  it('forgets everything when the session is rebuilt, and ignores a reply from the old build', () => {
    const c = client(1)
    const trees = new LambdaTrees(() => c)
    trees.want('s', 2)
    trees.store('s', 1, wire(2))
    c.gen = 2
    expect(trees.want('s', 2)).toEqual({ kind: 'none' })
    trees.store('s', 1, wire(2))
    expect(trees.want('s', 2)).toEqual({ kind: 'none' })
  })

  it('asks nothing while the client awaits a run, and keeps showing the tree it has', () => {
    const c = client(1)
    const trees = new LambdaTrees(() => c)
    trees.want('s', 2)
    const two = wire(2)
    trees.store('s', 1, two)
    c.gen = 2
    c.awaitingRun = true
    expect(trees.want('s', 2)).toEqual({ kind: 'tree', tree: two })
    expect(trees.want('s', 3)).toEqual({ kind: 'stale', tree: two })
    expect(c.tree).toHaveBeenCalledTimes(1)
    c.awaitingRun = false
    expect(trees.want('s', 0)).toEqual({ kind: 'none' })
    expect(c.tree).toHaveBeenLastCalledWith(0, LAMBDA_TREE_NODES)
  })

  it('names the build its trees come from, and keeps the old build while the client awaits a run', () => {
    const c = client(1)
    const trees = new LambdaTrees(() => c)
    expect(trees.buildOf('s')).toBeNull()
    trees.want('s', 0)
    expect(trees.buildOf('s')).toBe(1)
    c.gen = 2
    c.awaitingRun = true
    trees.want('s', 0)
    expect(trees.buildOf('s'), 'the frames on screen are still the old build’s').toBe(1)
    c.awaitingRun = false
    trees.want('s', 0)
    expect(trees.buildOf('s')).toBe(2)
  })

  it('answers none for a session with no client, and prunes sessions that are gone', () => {
    const c = client()
    const trees = new LambdaTrees((s) => (s === 's' ? c : undefined))
    expect(trees.want('gone', 0)).toEqual({ kind: 'none' })
    trees.want('s', 0)
    trees.store('s', 1, wire(0))
    trees.prune((s) => s !== 's')
    expect(trees.want('s', 0)).toEqual({ kind: 'none' })
  })
})
