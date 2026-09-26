import { afterEach, describe, expect, it, vi } from 'vitest'
import { LambdaBody } from '../../src/lambda-body'
import { codeLines, type Line, outlineLines } from '../../src/lambda-layout'
import { KIND_APP, Tree } from '../../src/lambda-tree'
import { wireOf } from '../node/tree-fixture'

/**
 * EVERYTHING A KEY OR A CLICK OPENS IN THE λ VIEW, ← FOLDS AGAIN — enumerated over the row shapes the two
 * layouts make, rather than found one probe at a time.
 *
 * For each shape, every route that opens a node is taken on every row: →, Enter, a click on a chip or a
 * `… N nodes`, and a click on a closed `▸`. The node a route opened is then drawn open, and ← on the row that
 * now shows it must fold that same node. So must a click on that row's `▾`, except where the row's gutter is
 * another node's — the layout gives a row to the outermost node that starts on it — which each shape lists
 * as its accepted pointer gaps.
 *
 * ENTER OPENS EXACTLY WHAT → OPENS, on every row, and links only from a row with nothing closed on it (spec
 * §5.2: a chip opens on Enter, like any fold).
 *
 * AND NO ROW NAMES A NODE IT DOES NOT START, in any state drawn: not in its `▸`/`▾`, and not in what its ←
 * folds. A broken node's closing `)` lands on its last row (`codeLines`'s `close`), and a row read by that
 * token once claimed a chip it only ended.
 */

function mount() {
  const toggle = vi.fn()
  const link = vi.fn()
  const body = new LambdaBody({ toggle, link })
  const host = document.createElement('section')
  host.className = 'pane lambda-fold-routes-fixture'
  host.style.width = '640px'
  host.append(body.el)
  document.body.append(host)
  return { body, toggle, link }
}

const rowAt = (i: number) =>
  document.querySelector<HTMLElement>(`.lambda-fold-routes-fixture .term-line[data-line="${i}"]`)
const press = (body: LambdaBody, key: string) =>
  body.el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
/** Put the active row on `row`, from the top, as a keyboard user would. */
const moveTo = (body: LambdaBody, row: number) => {
  press(body, 'Home')
  for (let k = 0; k < row; k += 1) press(body, 'ArrowDown')
}

/** The Church numeral `n` in `f` and `x`, which reads as the chip `n`. */
const numeral = (n: number): string => `\\f. \\x. ${Array(n).fill('f (').join('')}x${')'.repeat(n)}`
/** An application's head: its spine followed to the first node that is not an application. */
const headOf = (t: Tree, i: number): number => (t.kind(i) === KIND_APP ? headOf(t, t.left(i)) : i)
const chipsOf = (t: Tree): number[] => [...Array(t.count).keys()].filter((i) => t.chip(i) !== null)
/** The first chip-shaped node other than `i` — a chip under a binder of its own. */
const chipUnder = (t: Tree, i: number): number => chipsOf(t).find((c) => c !== i) ?? -1

type Shape = {
  readonly name: string
  readonly src: string
  readonly width: number
  readonly outline?: boolean
  /** Nodes drawn closed to start with, besides every chip. */
  readonly closed?: (t: Tree) => number[]
  /** The opened nodes no click can fold back: their row's `▾` is another node's. */
  readonly pointerGaps: (t: Tree) => number[]
}

const SHAPES: readonly Shape[] = [
  {
    name: 'code — an application whose head is folded, and breaks once opened',
    src: '(\\x. x a b c d e f g h) z',
    width: 12,
    closed: (t) => [headOf(t, 0)],
    pointerGaps: (t) => [headOf(t, 0)],
  },
  {
    name: 'code — an application whose head is a chip that breaks once opened',
    src: `(${numeral(2)}) a b c d e f g h`,
    width: 12,
    pointerGaps: (t) => [headOf(t, 0)],
  },
  {
    name: 'code — an application whose head is a chip that still fits once opened',
    src: `(${numeral(1)}) a b c d e f g h`,
    width: 12,
    pointerGaps: (t) => [headOf(t, 0)],
  },
  { name: 'code — a chip first on its row', src: numeral(2), width: 80, pointerGaps: () => [] },
  { name: 'code — a chip mid-row', src: `g (${numeral(2)})`, width: 80, pointerGaps: () => [] },
  { name: 'code — a chip mid-row that breaks once opened', src: `g (${numeral(4)})`, width: 10, pointerGaps: () => [] },
  { name: 'code — two chips on a row', src: `g (${numeral(1)}) (${numeral(2)})`, width: 80, pointerGaps: () => [] },
  {
    name: 'code — a chip that, opened, merges into its binder’s broken row',
    src: `\\g. ${numeral(4)}`,
    width: 12,
    pointerGaps: (t) => [chipUnder(t, 0)],
  },
  {
    name: 'code — a chip that, opened, merges into its binder’s row and still fits',
    src: `\\g. ${numeral(4)}`,
    width: 80,
    pointerGaps: () => [],
  },
  { name: 'code — a folded abstraction', src: '\\x. f x x x x', width: 8, closed: () => [0], pointerGaps: () => [] },
  {
    name: 'code — a folded argument',
    src: 'g (a b c d e f g h i)',
    width: 12,
    closed: (t) => [t.right(0)],
    pointerGaps: () => [],
  },
  {
    name: 'outline — an apply row whose head is a chip',
    src: `(${numeral(2)}) aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj`,
    width: 80,
    outline: true,
    pointerGaps: (t) => [headOf(t, 0)],
  },
  {
    name: 'outline — a chip mid-row that, opened, gets a row of its own',
    src: `g (${numeral(2)}) aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii`,
    width: 80,
    outline: true,
    pointerGaps: () => [],
  },
  {
    name: 'outline — a chip on a row of its own',
    src: `g (${numeral(2)}) aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk`,
    width: 80,
    outline: true,
    pointerGaps: () => [],
  },
  {
    name: 'outline — a chip that, opened, merges into its binder’s row',
    src: `\\g. ${numeral(20)}`,
    width: 80,
    outline: true,
    pointerGaps: (t) => [chipUnder(t, 0)],
  },
  {
    name: 'outline — a folded application',
    src: 'f aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk',
    width: 80,
    outline: true,
    closed: () => [0],
    pointerGaps: () => [],
  },
  {
    name: 'outline — an apply row whose head is folded, on a row of its own',
    src: '(\\x. x aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj) z',
    width: 80,
    outline: true,
    closed: (t) => [headOf(t, 0)],
    pointerGaps: () => [],
  },
]

afterEach(() => {
  for (const el of document.querySelectorAll('.lambda-fold-routes-fixture')) el.remove()
})

describe('everything a key or a click opens in the λ view, ← folds again', () => {
  for (const s of SHAPES) {
    it(s.name, () => {
      const t = new Tree(wireOf(s.src))
      const closed = new Set([...(s.closed?.(t) ?? []), ...chipsOf(t)])
      const lay = (open: (i: number) => boolean): Line[] =>
        (s.outline ? outlineLines : codeLines)(t, { width: s.width, vars: 'names', open })
      const { body, toggle, link } = mount()
      /** Each row whose `▸`/`▾` or ← names a node that starts on another row, in `lines` as drawn. */
      const strays = (lines: readonly Line[], state: string): string[] => {
        const start = (n: number) => lines.findIndex((l) => l.disclose === n || l.tokens.some((k) => k.node === n))
        const out: string[] = []
        press(body, 'Home')
        for (let r = 0; r < lines.length; r += 1) {
          if (r > 0) press(body, 'ArrowDown')
          const gutter = rowAt(r)?.querySelector<HTMLElement>('.term-gutter[data-node]')
          toggle.mockClear()
          press(body, 'ArrowLeft')
          const named: [string, number | undefined][] = [
            ['▸/▾', gutter ? Number(gutter.dataset.node) : undefined],
            ['←', toggle.mock.calls[0]?.[0]],
          ]
          for (const [what, n] of named) {
            if (n !== undefined && start(n) !== r)
              out.push(`${state}: row ${r}'s ${what} names ${n}, from row ${start(n)}`)
          }
        }
        return out
      }
      const before = lay((i) => !closed.has(i))
      body.showTree(t, before, s.outline === true, [], false)
      body.el.focus()
      const stray = strays(before, 'as drawn')

      /** Each row where Enter does other than open what → opens, or links where something is closed. */
      const enterUnlikeArrow: string[] = []
      for (let r = 0; r < before.length; r += 1) {
        toggle.mockClear()
        moveTo(body, r)
        press(body, 'ArrowRight')
        const arrow = toggle.mock.calls[0]?.[0]
        toggle.mockClear()
        link.mockClear()
        moveTo(body, r)
        press(body, 'Enter')
        const enter = toggle.mock.calls[0]?.[0]
        const linked = link.mock.calls.length > 0
        if (enter !== arrow || linked !== (arrow === undefined)) {
          enterUnlikeArrow.push(`row ${r}: → opens ${arrow}, Enter opens ${enter}${linked ? ' and links' : ''}`)
        }
      }
      expect(enterUnlikeArrow, 'rows where Enter does not open what → opens').toEqual([])

      const opened: { route: string; node: number }[] = []
      const take = (route: string, act: () => void) => {
        toggle.mockClear()
        act()
        const node = toggle.mock.calls[0]?.[0]
        if (node !== undefined) opened.push({ route, node })
      }
      for (let r = 0; r < before.length; r += 1) {
        take(`row ${r} →`, () => {
          moveTo(body, r)
          press(body, 'ArrowRight')
        })
        take(`row ${r} Enter`, () => {
          moveTo(body, r)
          press(body, 'Enter')
        })
        for (const tok of rowAt(r)?.querySelectorAll<HTMLElement>('.term-chip, .term-fold') ?? []) {
          take(`row ${r} click ${tok.textContent}`, () => tok.click())
        }
        const shut = rowAt(r)?.querySelector<HTMLElement>('.term-gutter[data-open="false"]')
        if (shut) take(`row ${r} ▸`, () => shut.click())
      }
      expect(opened.length, 'the shape has something to open').toBeGreaterThan(0)
      expect(
        opened.filter((o) => !closed.has(o.node)),
        'every route opens a node that was closed',
      ).toEqual([])

      const result = opened.map((o) => {
        const after = lay((i) => i === o.node || !closed.has(i))
        body.showTree(t, after, s.outline === true, [], false)
        stray.push(...strays(after, `${o.route}, opened`))
        const row = after.findIndex((l) => l.disclose === o.node || l.tokens.some((k) => k.node === o.node))
        toggle.mockClear()
        moveTo(body, row)
        press(body, 'ArrowLeft')
        const key = toggle.mock.calls[0]?.[0] === o.node
        toggle.mockClear()
        rowAt(row)?.querySelector<HTMLElement>('.term-gutter[data-open="true"]')?.click()
        const pointer = toggle.mock.calls[0]?.[0] === o.node
        return { ...o, row, key, pointer }
      })
      expect([...new Set(stray)], 'rows that name a node they do not start').toEqual([])
      expect(
        result.filter((x) => !x.key).map((x) => x.route),
        'routes whose node ← does not fold back',
      ).toEqual([])
      expect([...new Set(result.filter((x) => !x.pointer).map((x) => x.node))]).toEqual(s.pointerGaps(t))
    })
  }
})
