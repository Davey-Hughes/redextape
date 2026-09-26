import { describe, expect, it } from 'vitest'
import {
  codeLines,
  type LayoutOptions,
  type Line,
  lineOf,
  lineText,
  outlineLines,
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
 * BOTH LAYOUTS WALK AN EXPLICIT STACK, NOT THE CALL STACK. The automatic policy keeps the whole path to the
 * next redex open, so a layout that recursed once per open level overflowed on a legal program — `2990 + 0`
 * one step from its end — and wedged the view. This is the deepest application chain the node budget admits.
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
