import { describe, expect, it } from 'vitest'
import {
  codeLines,
  type LayoutOptions,
  type Line,
  lineOf,
  lineText,
  outlineLines,
  treePlaces,
  widths,
} from '../../src/lambda-layout'
import { KIND_ABS, KIND_APP, KIND_VAR, NO_LINK, Tree } from '../../src/lambda-tree'
import { LAMBDA_TREE_NODES, type LambdaTreeWire } from '../../src/protocol'
import { wireOf } from './tree-fixture'

const opts = (width: number, over: Partial<LayoutOptions> = {}): LayoutOptions => ({
  width,
  vars: 'names',
  open: () => true,
  ...over,
})
const texts = (lines: readonly Line[]) => lines.map(lineText)
const indents = (lines: readonly Line[]) => lines.map((l) => l.indent)

describe('codeLines', () => {
  it('writes a term that fits on one line exactly as the printer does', () => {
    expect(texts(codeLines(new Tree(wireOf('(\\x. x) y')), opts(80)))).toEqual(['(λx. x) y'])
    expect(texts(codeLines(new Tree(wireOf('f (g x) (\\y. y)')), opts(80)))).toEqual(['f (g x) (λy. y)'])
  })

  it('merges curried binders by name, and writes indices by de Bruijn', () => {
    const t = new Tree(wireOf('\\x. \\y. x'))
    expect(texts(codeLines(t, opts(80)))).toEqual(['λx y. x'])
    expect(texts(codeLines(t, opts(80, { vars: 'debruijn' })))).toEqual(['λ. λ. 1'])
  })

  it('measures every one-line term at exactly its written length', () => {
    for (const src of ['(\\x. x) y', 'f (g x) (\\y. y)', '\\x. \\y. x y', 'a (b (c d)) e', '(\\f. f f) (\\g. g)']) {
      const t = new Tree(wireOf(src))
      for (const vars of ['names', 'debruijn'] as const) {
        const [line] = codeLines(t, opts(1000, { vars }))
        expect(lineText(line as Line).length, `${src} (${vars})`).toBe(widths(t, opts(1000, { vars }))[0])
      }
    }
  })

  it('breaks a spine into its head and one argument per line', () => {
    const lines = codeLines(new Tree(wireOf('g (a b c d) (e f g h)')), opts(12))
    expect(texts(lines)).toEqual(['g', '(a b c d)', '(e f g h)'])
    expect(indents(lines)).toEqual([0, 2, 2])
    expect(lines.map((l) => l.disclose)).toEqual([0, -1, -1])
  })

  it('breaks an abstraction into its binders and its body', () => {
    const lines = codeLines(new Tree(wireOf('\\x. f x x x x')), opts(8))
    expect(texts(lines)).toEqual(['λx. ', 'f', 'x', 'x', 'x', 'x'])
    expect(indents(lines)).toEqual([0, 2, 4, 4, 4, 4])
  })

  it('keeps a broken head’s parentheses and gives the line to the outermost node', () => {
    const lines = codeLines(new Tree(wireOf('(\\x. x x x x) y')), opts(8))
    expect(texts(lines)).toEqual(['(λx. ', 'x', 'x', 'x', 'x)', 'y'])
    expect(indents(lines)).toEqual([0, 2, 4, 4, 4, 2])
    expect(lines[0]?.disclose).toBe(0)
  })

  it('remembers the head an application’s row began as, when that head breaks or is folded', () => {
    const t = new Tree(wireOf('(\\x. x a b c d e f g h) z'))
    const head = t.left(0)
    const first = (open: (i: number) => boolean) => codeLines(t, opts(12, { open }))[0]
    expect(first(() => true)?.inner).toBe(head)
    expect(first((i) => i !== head)?.inner).toBe(head)
    expect(first(() => true)?.disclose).toBe(0)
    expect(codeLines(new Tree(wireOf('g (a b c d) (e f g h)')), opts(12))[0]?.inner, 'a head that fits').toBeUndefined()
  })

  it('gives each line its nesting as its level — a broken head’s body sits under its application’s row', () => {
    const levels = (src: string, width: number) => codeLines(new Tree(wireOf(src)), opts(width)).map((l) => l.level)
    expect(levels('g (a b c d) (e f g h)', 12)).toEqual([1, 2, 2])
    expect(levels('\\x. f x x x x', 8)).toEqual([1, 2, 3, 3, 3, 3])
    expect(levels('(\\x. x x x x) y', 8)).toEqual([1, 2, 3, 3, 3, 2])
  })

  it('folds a closed node to its binders and a count', () => {
    const lines = codeLines(new Tree(wireOf('\\x. f x x x x')), opts(8, { open: (i) => i !== 0 }))
    expect(texts(lines)).toEqual(['λx. … 10 nodes'])
    expect(lines[0]?.disclose).toBe(0)
  })

  it('draws a closed chip as its value and an open one as its λ', () => {
    const t = new Tree(wireOf('(\\f. \\x. f (f x)) (\\t. \\f. f)'))
    const closed = codeLines(t, opts(80, { open: () => false }))
    expect(texts(closed)).toEqual(['2 false'])
    expect(closed[0]?.tokens.filter((k) => k.kind === 'chip').map((k) => k.text)).toEqual(['2', 'false'])
    expect(texts(codeLines(t, opts(80)))).toEqual(['(λf x. f (f x)) (λt f. f)'])
  })

  it('finds the line showing a node, including the fold that hides it', () => {
    const t = new Tree(wireOf('g (a b c d) (e f g h)'))
    const lines = codeLines(t, opts(12))
    const second = t.right(0)
    expect(lineOf(t, lines, second)).toBe(2)
    const f = new Tree(wireOf('\\x. f x x x x'))
    expect(lineOf(f, codeLines(f, opts(8, { open: (i) => i !== 0 })), 5)).toBe(0)
  })
})

describe('outlineLines', () => {
  it('gives a wide spine one row for its head and one per argument, a level deeper', () => {
    const t = new Tree(wireOf('f aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk'))
    const lines = outlineLines(t, opts(80))
    expect(texts(lines)).toEqual(['apply f', ...'abcdefghijk'.split('').map((c) => c.repeat(4))])
    expect(lines.map((l) => l.level)).toEqual([1, ...Array(11).fill(2)])
    expect(lines[0]?.disclose).toBe(0)
  })

  it('writes a narrow subterm as one row', () => {
    expect(texts(outlineLines(new Tree(wireOf('(\\x. x) y')), opts(80)))).toEqual(['(λx. x) y'])
  })

  it('moves a narrow head off the apply row when inlining it would still overflow the view', () => {
    const t = new Tree(wireOf('(\\x. x) y'))
    const lines = outlineLines(t, opts(8))
    expect(texts(lines)).toEqual(['apply', 'λx. x', 'y'])
    expect(lines.map((l) => l.level)).toEqual([1, 2, 2])
    for (const line of lines) {
      expect(line.indent + lineText(line).length, lineText(line)).toBeLessThanOrEqual(8)
    }
  })
})

/**
 * `λf. λx. f (f (… (f ((λz. z) x))))` with `n` applications of `f` — a numeral still being built, the shape a
 * sum's last steps leave — and its next redex at the bottom, `n` applications down. Built without recursing:
 * `wireOf`'s parser recurses once per level.
 */
function chain(n: number): LambdaTreeWire {
  const kind: number[] = [KIND_ABS, KIND_ABS]
  const left: number[] = [1, 2]
  const right: number[] = [0, 0]
  const name: number[] = [0, 1]
  for (let k = 0; k < n; k += 1) {
    const app = kind.length
    kind.push(KIND_APP, KIND_VAR)
    left.push(app + 1, 1)
    right.push(app + 2, 0)
    name.push(0, 0)
  }
  const redex = kind.length
  kind.push(KIND_APP, KIND_ABS, KIND_VAR, KIND_VAR)
  left.push(redex + 1, redex + 2, 0, 0)
  right.push(redex + 3, 0, 0, 0)
  name.push(0, 2, 2, 1)
  return {
    step: 0,
    refused: null,
    kind: Uint8Array.from(kind),
    left: Uint32Array.from(left),
    right: Uint32Array.from(right),
    name: Uint32Array.from(name),
    hint: Uint32Array.from(name),
    link: new Uint32Array(kind.length).fill(NO_LINK),
    names: ['f', 'x', 'z'],
    nextRedex: redex,
    contractum: null,
  }
}

/**
 * **A ROW'S PLACE IS AMONG ITS SIBLINGS, NOT AMONG THE ROWS.** The tree's rows are flat, with no `group` around a
 * row's children, so each row says how many rows share its parent and which of them it is.
 */
describe('treePlaces', () => {
  const places = (lines: readonly Pick<Line, 'level'>[]) => {
    const p = treePlaces(lines)
    return { setsize: [...p.setsize], posinset: [...p.posinset] }
  }
  const code = (src: string, width: number) => codeLines(new Tree(wireOf(src)), opts(width))

  it('counts a spine’s head alone and its arguments as a pair', () => {
    expect(places(code('g (a b c d) (e f g h)', 12))).toEqual({ setsize: [1, 2, 2], posinset: [1, 1, 2] })
  })

  it('starts a new set under each parent, though the level is the same', () => {
    const lines = code('g (a b c d) (e f g h)', 6)
    expect(
      lines.map((l) => l.level),
      'precondition: two pairs of level 3 rows under two level 2 rows',
    ).toEqual([1, 2, 3, 3, 3, 2, 3, 3, 3])
    expect(places(lines)).toEqual({ setsize: [1, 2, 3, 3, 3, 2, 3, 3, 3], posinset: [1, 1, 1, 2, 3, 2, 1, 2, 3] })
  })

  it('counts a broken head’s body and its application’s argument as siblings, as their levels say', () => {
    expect(places(code('(\\x. x x x x) y', 8))).toEqual({ setsize: [1, 2, 3, 3, 3, 2], posinset: [1, 1, 1, 2, 3, 2] })
  })

  it('counts an outline’s argument rows under their apply row', () => {
    const lines = outlineLines(new Tree(wireOf('f aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk')), opts(80))
    expect(places(lines)).toEqual({
      setsize: [1, ...Array(11).fill(11)],
      posinset: [1, ...Array.from({ length: 11 }, (_, i) => i + 1)],
    })
  })

  it('names as a row’s parent the nearest row above it that is shallower, at whatever level', () => {
    expect(places([{ level: 1 }, { level: 3 }, { level: 3 }, { level: 2 }, { level: 3 }])).toEqual({
      setsize: [1, 2, 2, 1, 1],
      posinset: [1, 1, 2, 1, 1],
    })
  })

  it('has nothing to say of no rows', () => {
    expect(places([])).toEqual({ setsize: [], posinset: [] })
  })

  /**
   * **NO LAYOUT WRITES A ROW MORE THAN ONE LEVEL PAST THE ROW ABOVE IT**, so a row's parent is always the nearest row
   * one level up, and `aria-level` never skips a level a reader would hear as missing. Held over every width a term
   * can break at, both ways of writing variables, and three fold patterns; and the places are checked against
   * counting the siblings out by hand.
   */
  it('agrees with the siblings counted out by hand, over layouts that never skip a level', () => {
    const sources = [
      'g (a b c d) (e f g h)',
      '\\x. f x x x x',
      '(\\x. x x x x) y',
      '(\\f. f f) (\\g. g)',
      'a (b (c d)) e',
      '\\f. \\x. f (f (f (f (f x))))',
      '(\\x. \\y. x (y y y) (x x)) (\\z. z z) (\\w. w)',
    ]
    const byHand = (lines: readonly Line[], i: number) => {
      const level = (lines[i] as Line).level
      let start = i
      while (start > 0 && (lines[start - 1] as Line).level >= level) start -= 1
      let end = i
      while (end < lines.length - 1 && (lines[end + 1] as Line).level >= level) end += 1
      const set = lines.slice(start, end + 1).flatMap((l, k) => (l.level === level ? [start + k] : []))
      return { setsize: set.length, posinset: set.indexOf(i) + 1 }
    }
    let rows = 0
    for (const src of sources) {
      const t = new Tree(wireOf(src))
      for (const lay of [codeLines, outlineLines]) {
        for (const vars of ['names', 'debruijn'] as const) {
          for (let width = 1; width <= 60; width += 1) {
            for (const open of [() => true, () => false, (n: number) => n % 2 === 1]) {
              const lines = lay(t, opts(width, { vars, open }))
              const p = treePlaces(lines)
              for (const [i, line] of lines.entries()) {
                const id = `${src} ${lay.name} ${vars} width ${width} row ${i}`
                if (i === 0) expect(line.level, id).toBe(1)
                else expect(line.level, id).toBeLessThanOrEqual((lines[i - 1] as Line).level + 1)
                expect({ setsize: p.setsize[i], posinset: p.posinset[i] }, id).toEqual(byHand(lines, i))
                rows += 1
              }
            }
          }
        }
      }
    }
    expect(rows, 'precondition: the sweep laid rows out').toBeGreaterThan(5_000)
  })
})

/**
 * BOTH LAYOUTS WALK AN EXPLICIT STACK, NOT THE CALL STACK. The automatic policy keeps the whole path to the
 * next redex open, so a layout that recursed once per open level would overflow on a legal program — `2990 + 0`
 * one step from its end — and wedge the view. This is the deepest application chain the node budget admits.
 */
describe('the layouts at depth', () => {
  const n = Math.floor((LAMBDA_TREE_NODES - 6) / 2)
  const t = new Tree(chain(n))

  it('builds the chain it means to', () => {
    expect(t.count).toBeLessThanOrEqual(LAMBDA_TREE_NODES)
    expect(t.maxDepth).toBeGreaterThan(n)
    expect(t.chip(0)).toBeNull()
    expect(texts(codeLines(new Tree(chain(2)), opts(80)))).toEqual(['λf x. f (f ((λz. z) x))'])
  })

  for (const [name, lay] of [
    ['code', codeLines],
    ['outline', outlineLines],
  ] as const) {
    it(`lays out every level of the path to the next redex in the ${name} layout`, () => {
      const lines = lay(t, opts(80))
      const at = lineOf(t, lines, t.wire.nextRedex as number)
      expect(at, 'the redex has a line').toBeGreaterThanOrEqual(0)
      expect(lines[at]?.level, 'nested once per application above it').toBeGreaterThan(n)
    })
  }
})
