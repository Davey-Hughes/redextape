import { describe, expect, it } from 'vitest'
import { LinkIndex, type LinkIndexWire } from '../../src/link'

/**
 * A hand-built index. Source spans are deliberately NESTED — `[0,17)` contains `[4,5)` and `[12,17)` —
 * because "innermost wins" is the rule under test and disjoint spans would not exercise it.
 */
function wire(over: Partial<LinkIndexWire> = {}): LinkIndexWire {
  return {
    lambdaText: '(λx. x) y',
    lambdaTruncated: false,
    lambdaSpanStart: new Uint32Array([0, 1, 3, 5, 7, 9]),
    lambdaSpanEnd: new Uint32Array([1, 3, 4, 6, 8, 10]),
    lambdaSpanClass: new Uint8Array([5, 7, 7, 0, 5, 0]),
    lambdaNodeStart: new Uint32Array([0, 1, 6]),
    lambdaNodeEnd: new Uint32Array([10, 8, 7]),
    lambdaNodeId: new Uint32Array([100, 101, 102]),
    sourceNodeStart: new Uint32Array([0, 4, 12]),
    sourceNodeEnd: new Uint32Array([17, 5, 17]),
    sourceNodeId: new Uint32Array([100, 101, 102]),
    tmOwner: new Int32Array([-1, 100, 101, 100, -1]),
    ...over,
  }
}

describe('LinkIndex.nodeAtSource', () => {
  it('the innermost containing span wins, never an ancestor', () => {
    const ix = new LinkIndex(wire())
    expect(ix.nodeAtSource(4)).toBe(101)
    expect(ix.nodeAtSource(13)).toBe(102)
    // Inside the outermost only.
    expect(ix.nodeAtSource(2)).toBe(100)
  })

  it('a span is half-open: start is inside, end is not', () => {
    const ix = new LinkIndex(wire())
    expect(ix.nodeAtSource(12)).toBe(102)
    // `[4,5)` ends at 5, so offset 5 falls back to the enclosing `[0,17)`.
    expect(ix.nodeAtSource(5)).toBe(100)
    // 17 is past every span's end.
    expect(ix.nodeAtSource(17)).toBeNull()
  })

  it('an offset in no span, a negative offset, and an empty index all answer null', () => {
    const ix = new LinkIndex(wire())
    expect(ix.nodeAtSource(999)).toBeNull()
    expect(ix.nodeAtSource(-1)).toBeNull()
    const empty = new LinkIndex(
      wire({ sourceNodeStart: new Uint32Array(), sourceNodeEnd: new Uint32Array(), sourceNodeId: new Uint32Array() }),
    )
    expect(empty.nodeAtSource(0)).toBeNull()
  })

  it('breaks a tie between byte-identical spans in favour of the first', () => {
    // THE RULE IS `<`, NOT `<=`, and nothing else in this file pins it. Two spans of equal width
    // containing the same offset: the earlier entry must win. Changing the comparison to `<=` makes
    // the later one win and fails only this test.
    const ix = new LinkIndex(
      wire({
        sourceNodeStart: new Uint32Array([0, 4, 4]),
        sourceNodeEnd: new Uint32Array([17, 9, 9]),
        sourceNodeId: new Uint32Array([100, 101, 102]),
      }),
    )
    expect(ix.nodeAtSource(5)).toBe(101)
  })
})

describe('LinkIndex.nodeAtLambda', () => {
  it('the innermost containing span wins', () => {
    const ix = new LinkIndex(wire())
    expect(ix.nodeAtLambda(6)).toBe(102)
    expect(ix.nodeAtLambda(2)).toBe(101)
    expect(ix.nodeAtLambda(9)).toBe(100)
  })
})

describe('LinkIndex.nodeForState', () => {
  it('resolves an owner and reports -1 as null', () => {
    const ix = new LinkIndex(wire())
    expect(ix.nodeForState(1)).toBe(100)
    expect(ix.nodeForState(2)).toBe(101)
    expect(ix.nodeForState(0)).toBeNull()
  })

  it('a state id outside the array is null, never a wrap or a throw', () => {
    const ix = new LinkIndex(wire())
    expect(ix.nodeForState(5)).toBeNull()
    expect(ix.nodeForState(-1)).toBeNull()
  })
})

describe('LinkIndex.linkFor', () => {
  it('gathers all three legs, and states are ascending', () => {
    const ix = new LinkIndex(wire())
    expect(ix.linkFor(100)).toEqual({
      source: { start: 0, end: 17 },
      lambda: { start: 0, end: 10 },
      states: [1, 3],
    })
  })

  it('reports each leg absent independently', () => {
    const ix = new LinkIndex(wire())
    // 102 owns no state.
    expect(ix.linkFor(102).states).toEqual([])
    expect(ix.linkFor(102).source).toEqual({ start: 12, end: 17 })
    // A node nobody has heard of.
    expect(ix.linkFor(999)).toEqual({ source: null, lambda: null, states: [] })
  })

  it('a node whose lambda subterm fell past the cut has a source span and no lambda span', () => {
    const ix = new LinkIndex(
      wire({
        lambdaTruncated: true,
        lambdaNodeStart: new Uint32Array([0]),
        lambdaNodeEnd: new Uint32Array([10]),
        lambdaNodeId: new Uint32Array([100]),
      }),
    )
    expect(ix.linkFor(101).lambda).toBeNull()
    expect(ix.linkFor(101).source).toEqual({ start: 4, end: 5 })
  })
})

describe('LinkIndex.lambdaSpans', () => {
  it('rehydrates class discriminants into TokenClass names', () => {
    const ix = new LinkIndex(wire())
    expect(ix.lambdaSpans[0]).toEqual([{ start: 0, end: 1 }, 'Punct'])
    expect(ix.lambdaSpans[1]).toEqual([{ start: 1, end: 3 }, 'Binder'])
    expect(ix.lambdaSpans[3]).toEqual([{ start: 5, end: 6 }, 'Ident'])
  })

  // LAZY AND CACHED, NOT REBUILT ON EVERY READ. A getter that rehydrated the wire on every access would
  // still pass the test above but would reintroduce the per-read allocation the laziness exists to
  // avoid; reference equality across two reads is what distinguishes "built once, cached" from "built
  // fresh every time this property is read".
  it('caches the rehydrated array rather than rebuilding it on every read', () => {
    const ix = new LinkIndex(wire())
    expect(ix.lambdaSpans).toBe(ix.lambdaSpans)
  })
})
