import { describe, expect, it } from 'vitest'
import { codeLines } from '../../src/lambda-layout'
import { Tree } from '../../src/lambda-tree'
import { icicleRect, lineAtMinimap, MINIMAP_LINE, minimapScroll, nodeAtIcicle, visibleNodes } from '../../src/term-map'
import { wireOf } from './tree-fixture'

// `(\x. x) y` in pre-order: 0 App, 1 Abs x, 2 Var x, 3 Var y — depths 0, 1, 2, 1.
const t = new Tree(wireOf('(\\x. x) y'))

describe('icicleRect', () => {
  it('gives each node a row by depth and a width by subtree size', () => {
    expect(icicleRect(t, 0)).toEqual({ x: 0, y: 0, w: 1, h: 1 / 3 })
    expect(icicleRect(t, 1)).toEqual({ x: 0.25, y: 1 / 3, w: 0.5, h: 1 / 3 })
    expect(icicleRect(t, 3)).toEqual({ x: 0.75, y: 1 / 3, w: 0.25, h: 1 / 3 })
  })

  it('nests every child inside its parent', () => {
    const big = new Tree(wireOf('f (\\a. a (b c)) (d (e g) h)'))
    for (let i = 1; i < big.count; i += 1) {
      const c = icicleRect(big, i)
      const p = icicleRect(big, big.parent[i] as number)
      expect(c.x).toBeGreaterThanOrEqual(p.x)
      expect(c.x + c.w).toBeLessThanOrEqual(p.x + p.w + 1e-9)
      expect(c.y).toBeGreaterThan(p.y)
    }
  })
})

describe('nodeAtIcicle', () => {
  it('names the node whose rectangle holds the point', () => {
    for (let i = 0; i < t.count; i += 1) {
      const r = icicleRect(t, i)
      expect(nodeAtIcicle(t, r.x + r.w / 2, r.y + r.h / 2), `node ${i}`).toBe(i)
    }
  })

  it('names the deepest node where a column ends above the row clicked', () => {
    // Below `y` (node 3, depth 1) there is nothing at depth 2, so a click there names `y` itself.
    expect(nodeAtIcicle(t, 0.8, 0.9)).toBe(3)
  })
})

describe('visibleNodes', () => {
  it('spans the nodes the given lines show, a fold covering its whole subtree', () => {
    const w = new Tree(wireOf('g (a b c d) (e f g h)'))
    const lines = codeLines(w, { width: 12, vars: 'names', open: () => true })
    expect(visibleNodes(w, lines, 1, 1)).toEqual({ lo: w.right(w.left(0)), hi: w.right(w.left(0)) + 7 })
    const folded = codeLines(w, { width: 12, vars: 'names', open: (i) => i !== 0 })
    expect(visibleNodes(w, folded, 0, 0)).toEqual({ lo: 0, hi: w.count })
    expect(visibleNodes(w, lines, 5, 9)).toBeNull()
  })
})

describe('minimapScroll', () => {
  it('does not scroll a term that fits the map', () => {
    // 50 lines are 100 px, in a map of 120.
    expect(minimapScroll(50, 10, 20, 120)).toBe(0)
  })

  it('scrolls a taller term as far through its overflow as the view is through its own', () => {
    // 300 lines are 600 px in a map of 120: 480 px of overflow. The view shows 30 lines, with 270 to scroll through.
    expect(minimapScroll(300, 0, 29, 120)).toBe(0)
    expect(minimapScroll(300, 135, 164, 120)).toBe(240)
    expect(minimapScroll(300, 270, 299, 120)).toBe(480)
  })

  it('keeps the view’s window on the map wherever the view is scrolled', () => {
    for (let first = 0; first <= 270; first += 1) {
      const top = first * MINIMAP_LINE - minimapScroll(300, first, first + 29, 120)
      expect(top, `first ${first}`).toBeGreaterThanOrEqual(0)
      expect(top + 30 * MINIMAP_LINE, `first ${first}`).toBeLessThanOrEqual(120)
    }
  })
})

describe('lineAtMinimap', () => {
  it('maps a point on the map to a line, through how far the minimap is scrolled, clamped', () => {
    expect(lineAtMinimap(10, 0, 0)).toBe(0)
    expect(lineAtMinimap(10, 5, 0)).toBe(2)
    expect(lineAtMinimap(300, 5, 240)).toBe(122)
    expect(lineAtMinimap(10, 119, 0)).toBe(9)
    expect(lineAtMinimap(0, 50, 0)).toBe(0)
  })
})
