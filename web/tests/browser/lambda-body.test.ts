import { computeAccessibleName } from 'dom-accessibility-api'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { LANES, LINE_HEIGHT, NARROW_LANES } from '../../src/lambda-body'
import { codeLines, type LayoutOptions, type Line, outlineLines } from '../../src/lambda-layout'
import { Tree } from '../../src/lambda-tree'
import type { LambdaState } from '../../src/types'
import { spanBytes } from '../node/span-bytes'
import { wireOf } from '../node/tree-fixture'
import { barPieces, barRows, drawsEdge, frames, keyOnBody, stripWidth, wordEdges } from './harness'
import { mountLambdaBody } from './lambda-body-fixture'

const opts = (width: number): LayoutOptions => ({ width, vars: 'names', open: () => true })

/** A body in a host `width` px wide. */
const mount = (width = 640) => {
  const m = mountLambdaBody('lambda-body-fixture')
  ;(m.body.el.parentElement as HTMLElement).style.width = `${width}px`
  return m
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture .term-line')]
/** A row's text: its tokens — the gutter and the marks' words are CSS, not text. */
const shown = (row: HTMLElement) => row.textContent ?? ''

/** `f a0 a1 … a{n-1}`, then a redex last — a spine that breaks one argument per line at a narrow width. */
const long = (n: number) => `f ${Array.from({ length: n }, (_, i) => `a${i}`).join(' ')} ((\\y. y) z)`

afterEach(() => {
  for (const el of document.querySelectorAll('.lambda-body-fixture')) el.remove()
})

/** At width 20, nine rows; node 5, `f a0 … a4`, starts at row 2’s second token and ends on row 7. */
const TALL = 'g x (f a0 a1 a2 a3 a4 a5)'
/** One row: node 3 is the redex `((λy. y) z)`, node 7 is `(w v)`. */
const ROW = 'k ((\\y. y) z) (w v)'
/** At width 12, node 3, `(f a0 … a4)`, is on rows 1-6, and node 14, `(h b0 … b4)`, on rows 7-12. */
const PAIR = 'g (f a0 a1 a2 a3 a4) (h b0 b1 b2 b3 b4)'
/** At width 24, a first row as long as the default program's `(λsum_to. sum_to 5)`, and a short one under it. */
const FIRST = '(\\s. s a0 a1 a2 a3) (b0 b1)'
/** A body as wide as the fixture's, and one too narrow for `LANES` (`lanesFor`). */
const WIDTHS = [
  { host: 640, lanes: LANES },
  { host: 174, lanes: NARROW_LANES },
] as const

const box = (el: Element) => el.getBoundingClientRect()
const LANE_ORDER = ['contractum', 'next-redex', 'linked'] as const
const tokens = () => [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture .term-line [data-node]')]
const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const encloses = (a: DOMRect, b: DOMRect) =>
  b.left >= a.left - 0.5 && b.right <= a.right + 0.5 && b.top >= a.top - 0.5 && b.bottom <= a.bottom + 0.5
const edged = () => wordEdges(document.querySelector('.lambda-body-fixture .term'))
/** A computed `box-shadow`'s shadows, each as its lengths: x, y, blur, spread. */
const shadows = (s: CSSStyleDeclaration) =>
  s.boxShadow.split(/,(?![^(]*\))/).map((sh) => [...sh.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1])))
/** The lines in `lines` holding a token of `t`'s node `node`. */
const rowsOf = (t: Tree, lines: readonly Line[], node: number) =>
  lines.flatMap((l, i) => (l.tokens.some((k) => t.contains(node, k.node)) ? [i] : []))
/**
 * Each link piece in `term` as its row's line, how far it stops short of the row's top, whether it draws a tick
 * there, how far short of the row's bottom, and whether it draws a tick there.
 */
const linkShape = (term: Element) =>
  barPieces(term, 'linked').map((p) => {
    const [b, row] = [box(p), p.closest<HTMLElement>('.term-line') as HTMLElement]
    const s = getComputedStyle(p)
    return [
      Number(row.dataset.line),
      b.top - box(row).top,
      drawsEdge(s, 'Top'),
      box(row).bottom - b.bottom,
      drawsEdge(s, 'Bottom'),
    ]
  })

describe('LambdaBody', () => {
  /**
   * THE CODE LAYOUT IS A TREE TOO, NOT A LIST: a roving cursor (`aria-activedescendant`) and `aria-expanded`
   * are not valid on a list's items. `data-layout` is what tells the two layouts apart.
   */
  it('draws each laid-out line as one row of the fixed line height, in a tree of levelled items', () => {
    const { body } = mount()
    const t = new Tree(wireOf('g (a b c d) (e f g h)'))
    body.showTree(t, codeLines(t, opts(12)), false, [], false)
    expect(rows().map(shown)).toEqual(['g', '(a b c d)', '(e f g h)'])
    expect(body.el.getAttribute('role')).toBe('tree')
    expect(body.el.dataset.layout).toBe('code')
    expect(rows().map((r) => r.getAttribute('aria-level'))).toEqual(['1', '2', '2'])
    expect(rows().map((r) => r.getAttribute('aria-expanded'))).toEqual(['true', null, null])
    for (const r of rows()) {
      expect(r.getBoundingClientRect().height).toBe(LINE_HEIGHT)
      expect(r.getAttribute('role')).toBe('treeitem')
      expect(r.getAttribute('aria-setsize')).toBe('3')
    }
  })

  it('is a tree of levelled items in the outline', () => {
    const { body } = mount()
    const t = new Tree(wireOf('f aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk'))
    body.showTree(t, outlineLines(t, opts(80)), true, [], false)
    expect(body.el.getAttribute('role')).toBe('tree')
    expect(body.el.dataset.layout).toBe('outline')
    expect(rows().map((r) => r.getAttribute('aria-level'))).toEqual(['1', ...Array(11).fill('2')])
    expect(rows()[0]?.getAttribute('aria-expanded')).toBe('true')
  })

  it('marks the next redex and the contractum each with its own shape, and says so to a screen reader', () => {
    const { body } = mount()
    // `k ((\y. y) z) (w v)`: the redex is node 3; say the last step produced node 7, `(w v)`.
    const t = new Tree(wireOf('k ((\\y. y) z) (w v)', { contractum: 7 }))
    body.showTree(t, codeLines(t, opts(80)), false, [], false)
    const redex = [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture .term-mark.is-next-redex')]
    expect(redex.map((s) => s.textContent).join('')).toBe('((λy. y) z)')
    expect(getComputedStyle(redex[0] as HTMLElement).outlineStyle).toBe('dashed')
    const made = [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture .term-mark.is-contractum')]
    expect(made.map((s) => s.textContent).join('')).toBe('(w v)')
    expect(getComputedStyle(made[0] as HTMLElement).boxShadow).toContain('inset')
    const labels = [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture [data-marks]')].map(
      (l) => l.dataset.marks,
    )
    expect(labels).toEqual(['next redex: ', 'just produced: '])
    const said = getComputedStyle(
      document.querySelector('.lambda-body-fixture [data-marks]') as Element,
      '::before',
    ).content
    expect(said).toBe('"next redex: "')
    expect(body.el.textContent).not.toContain('next redex')
  })

  it('marks linked nodes', () => {
    const { body } = mount()
    const t = new Tree(wireOf('k (a b) (c d)'))
    body.showTree(t, codeLines(t, opts(80)), false, [6], false)
    const linked = [...document.querySelectorAll('.lambda-body-fixture .term-mark.is-linked')]
      .map((s) => s.textContent)
      .join('')
    expect(linked).toBe('(c d)')
  })

  it('says a tree for another step is stale while it waits', () => {
    const { body } = mount()
    const t = new Tree(wireOf('x', { step: 4 }))
    body.showTree(t, codeLines(t, opts(80)), false, [], true)
    expect(body.el.dataset.stale).toBe('true')
    expect(body.el.getAttribute('aria-busy')).toBe('true')
    expect(body.el.dataset.step).toBe('4')
    body.showTree(t, codeLines(t, opts(80)), false, [], false)
    expect(body.el.dataset.stale).toBeUndefined()
    expect(body.el.hasAttribute('aria-busy')).toBe(false)
  })

  it('falls back to the frame’s flat text, with a note when there is one', () => {
    const { body } = mount()
    const frame: LambdaState = {
      text: 'λx. x',
      spans: new Uint8Array(),
      cut: null,
      step: 3,
      redex_span: null,
      owner: 'None',
    }
    body.showText(frame, 'this step’s term has 40,000 nodes — shown as text')
    expect(body.el.getAttribute('role')).toBe('region')
    expect(body.el.dataset.layout).toBe('flat')
    expect(rows()).toHaveLength(0)
    expect(body.el.querySelector('.term-flat')?.textContent).toContain('λx. x')
    expect(body.el.querySelector('.term-note')?.textContent).toContain('40,000 nodes')
  })

  it('marks a flat frame’s contractum by converting its byte span, not by slicing it as UTF-16', () => {
    const { body } = mount()
    // `λ` is two bytes and one UTF-16 unit, so a byte span sliced as UTF-16 lands one unit late per `λ`.
    const text = 'λf. (λx0. f (f x0))'
    const frame: LambdaState = {
      text,
      spans: spanBytes([
        [{ start: 0, end: 2 }, 'Binder'],
        [{ start: 2, end: 3 }, 'Binder'],
        [{ start: 5, end: 6 }, 'Punct'],
        [{ start: 6, end: 8 }, 'Binder'],
        [{ start: 8, end: 10 }, 'Binder'],
        [{ start: 10, end: 11 }, 'Punct'],
        [{ start: 12, end: 13 }, 'Ident'],
        [{ start: 14, end: 15 }, 'Punct'],
        [{ start: 15, end: 16 }, 'Ident'],
        [{ start: 17, end: 19 }, 'Ident'],
        [{ start: 19, end: 21 }, 'Punct'],
      ]),
      cut: null,
      step: 6,
      redex_span: { start: 5, end: 21 },
      owner: 'None',
    }
    body.showText(frame, null)
    // ONE SPAN ROUND THE RUN, the gaps between its tokens inside it, so it is drawn as one shape.
    const lit = [...body.el.querySelectorAll('.is-contractum')].map((e) => e.textContent)
    expect(lit).toEqual(['(λx0. f (f x0))'])
  })

  it('opens and folds from the gutter and a chip, and links from any other token', () => {
    const { body, toggle, link } = mount()
    const t = new Tree(wireOf('g (\\f. \\x. f x) (a b c d)'))
    body.showTree(t, codeLines(t, { width: 12, vars: 'names', open: (i) => t.chip(i) === null }), false, [], false)
    document.querySelector<HTMLElement>('.lambda-body-fixture .term-gutter[data-node]')?.click()
    expect(toggle).toHaveBeenLastCalledWith(0)
    document.querySelector<HTMLElement>('.lambda-body-fixture .term-chip')?.click()
    expect(toggle).toHaveBeenLastCalledWith(t.right(t.left(0)))
    const b = [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture .tok-ident')].find(
      (s) => s.textContent === 'b',
    )
    b?.click()
    expect(link).toHaveBeenCalledWith(Number(b?.dataset.node))
  })

  /**
   * A CLICK MAKES ITS ROW THE ACTIVE ONE, AND PAINTS IT SO, rather than leaving the paint to the redraw its event
   * would bring: a click that links nothing brings none, so `.is-active` and `aria-activedescendant` would stay on
   * the row before.
   */
  it('paints the clicked row active when the click redraws nothing', () => {
    const { body, link } = mount()
    const t = new Tree(wireOf('g (a b c d) (e f g h)'))
    body.showTree(t, codeLines(t, opts(12)), false, [], false)
    expect(rows()[0]?.classList.contains('is-active')).toBe(true)
    rows()[2]?.querySelector<HTMLElement>('.tok-ident')?.click()
    expect(link, 'the click reached a token').toHaveBeenCalled()
    expect(rows().map((r) => r.classList.contains('is-active'))).toEqual([false, false, true])
    expect(body.el.getAttribute('aria-activedescendant')).toBe(rows()[2]?.id)
  })

  it('moves one active row by keyboard, and folds and opens it with the arrows', () => {
    const { body, toggle, link } = mount()
    const t = new Tree(wireOf('g (a b c d) (e f g h)'))
    body.showTree(t, codeLines(t, opts(12)), false, [], false)
    body.el.focus()
    const active = () => body.el.getAttribute('aria-activedescendant')
    expect(active()).toBe(rows()[0]?.id)
    body.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(active()).toBe(rows()[1]?.id)
    body.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    body.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(toggle).toHaveBeenLastCalledWith(0)
    body.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(link).toHaveBeenCalledWith(2)
  })

  /**
   * A ROW IS OPEN WHEN THE NODE IT DISCLOSES IS. An application whose head is too wide writes that head's
   * first line as its own, so a folded head's `… N nodes` sits on the row of an open application: read by
   * "any fold on the row", the application would show `▸`, and ← and → would each do the other's job.
   */
  it('reads an open application as open when its folded head shares its row, and opens that head by key', () => {
    const { body, toggle } = mount()
    const t = new Tree(wireOf('(\\x. x a b c d e f g h) z'))
    const head = t.left(0)
    body.showTree(t, codeLines(t, { width: 12, vars: 'names', open: (i) => i !== head }), false, [], false)
    const first = rows()[0] as HTMLElement
    expect(first.querySelector<HTMLElement>('.term-fold')?.dataset.node, 'the head’s fold, on the row').toBe(
      String(head),
    )
    expect(first.querySelector<HTMLElement>('.term-gutter')?.dataset.node).toBe('0')
    expect(first.querySelector<HTMLElement>('.term-gutter')?.dataset.open).toBe('true')
    expect(first.getAttribute('aria-expanded')).toBe('true')
    body.el.focus()
    keyOnBody(body, 'Home')
    keyOnBody(body, 'ArrowRight')
    expect(toggle.mock.calls, '→ opens only what is closed').toEqual([[head]])
    keyOnBody(body, 'ArrowLeft')
    expect(toggle).toHaveBeenLastCalledWith(0)
  })

  /**
   * ENTER OPENS WHAT → OPENS, LIKE ANY FOLD (spec §5.2: "A chip opens on click or Enter, like any fold"). A row
   * with anything closed on it — a `… N nodes` or a chip — opens the first of them, and only a row with nothing
   * closed links.
   */
  it('opens a folded row with Enter, as → does, and links only from a row with nothing closed', () => {
    const { body, toggle, link } = mount()
    const app = new Tree(wireOf('(\\x. x a b c d e f g h) z'))
    const head = app.left(0)
    body.showTree(app, codeLines(app, { width: 12, vars: 'names', open: (i) => i !== head }), false, [], false)
    body.el.focus()
    keyOnBody(body, 'Home')
    keyOnBody(body, 'Enter')
    expect(toggle.mock.calls, 'the folded head on its application’s row').toEqual([[head]])

    toggle.mockClear()
    const abs = new Tree(wireOf('\\x. f x x x x'))
    body.showTree(abs, codeLines(abs, { width: 8, vars: 'names', open: (i) => i !== 0 }), false, [], false)
    keyOnBody(body, 'Home')
    keyOnBody(body, 'Enter')
    expect(toggle.mock.calls, 'a folded abstraction').toEqual([[0]])
    expect(link, 'a row with something closed on it').not.toHaveBeenCalled()

    toggle.mockClear()
    body.showTree(abs, codeLines(abs, opts(8)), false, [], false)
    keyOnBody(body, 'Home')
    keyOnBody(body, 'Enter')
    expect(toggle, 'the same row, opened').not.toHaveBeenCalled()
    expect(link).toHaveBeenCalledWith(0)
  })

  /**
   * A CHIP OPENS BY KEY, LIKE ANY FOLD (spec §5.2). The layout gives a chip's row no disclosure — the chip is
   * one line, and so, opened, is a small numeral — so → would return early, Enter would link from it, and once
   * open nothing but "reset folds" could make it a chip again. A finished run's value is a root chip: the case.
   */
  it('opens a chip with → or Enter, and folds it back with ←, as an ordinary open λ row', () => {
    const { body, toggle, link } = mount()
    const t = new Tree(wireOf('\\f. \\x. f (f x)'))
    body.showTree(t, codeLines(t, { width: 80, vars: 'names', open: (i) => t.chip(i) === null }), false, [], false)
    const row = () => rows()[0] as HTMLElement
    expect(rows().map(shown)).toEqual(['2'])
    expect(row().getAttribute('aria-expanded')).toBe('false')
    expect(row().querySelector<HTMLElement>('.term-gutter')?.dataset.open).toBe('false')
    expect(row().querySelector<HTMLElement>('.term-gutter')?.title, 'what the glyph does').toBe('open')
    body.el.focus()
    keyOnBody(body, 'ArrowLeft')
    expect(toggle, '← on a closed chip').not.toHaveBeenCalled()
    keyOnBody(body, 'ArrowRight')
    expect(toggle.mock.calls).toEqual([[0]])
    keyOnBody(body, 'Enter')
    expect(toggle.mock.calls).toEqual([[0], [0]])
    expect(link, 'Enter on a chip opens it').not.toHaveBeenCalled()

    toggle.mockClear()
    body.showTree(t, codeLines(t, { width: 80, vars: 'names', open: () => true }), false, [], false)
    expect(rows().map(shown)).toEqual(['λf x. f (f x)'])
    expect(row().getAttribute('aria-expanded')).toBe('true')
    expect(row().querySelector<HTMLElement>('.term-gutter')?.dataset.open).toBe('true')
    expect(row().querySelector<HTMLElement>('.term-gutter')?.title).toBe('fold')
    keyOnBody(body, 'ArrowRight')
    expect(toggle, '→ with nothing closed').not.toHaveBeenCalled()
    keyOnBody(body, 'ArrowLeft')
    expect(toggle.mock.calls).toEqual([[0]])
    keyOnBody(body, 'Enter')
    expect(link, 'Enter on an open λ row links').toHaveBeenCalledWith(0)
    row().querySelector<HTMLElement>('.term-gutter')?.click()
    expect(toggle.mock.calls, 'and a pointer can fold it back too').toEqual([[0], [0]])
  })

  /**
   * A CHIP ANYWHERE ON ITS ROW, NOT ONLY FIRST. Numerals and booleans are mostly arguments: `g 2` is a row
   * whose first token is `g`. Read only at the first token, it would have no `aria-expanded`, → would open the
   * chip, and nothing but "reset folds" would make it a chip again.
   */
  it('discloses a chip in the middle of its row, and folds it back with ← or the gutter', () => {
    const { body, toggle, link } = mount()
    const t = new Tree(wireOf('g (\\f. \\x. f (f x))'))
    const chip = t.right(0)
    body.showTree(t, codeLines(t, { width: 80, vars: 'names', open: (i) => t.chip(i) === null }), false, [], false)
    const row = () => rows()[0] as HTMLElement
    const gutter = () => row().querySelector<HTMLElement>('.term-gutter')
    expect(rows().map(shown)).toEqual(['g 2'])
    expect(row().getAttribute('aria-expanded')).toBe('false')
    expect(gutter()?.dataset.node).toBe(String(chip))
    body.el.focus()
    keyOnBody(body, 'ArrowRight')
    keyOnBody(body, 'Enter')
    expect(toggle.mock.calls).toEqual([[chip], [chip]])
    expect(link).not.toHaveBeenCalled()

    toggle.mockClear()
    body.showTree(t, codeLines(t, { width: 80, vars: 'names', open: () => true }), false, [], false)
    expect(rows().map(shown)).toEqual(['g (λf x. f (f x))'])
    expect(row().getAttribute('aria-expanded')).toBe('true')
    expect(gutter()?.dataset.open).toBe('true')
    keyOnBody(body, 'ArrowLeft')
    gutter()?.click()
    expect(toggle.mock.calls).toEqual([[chip], [chip]])
    keyOnBody(body, 'Enter')
    expect(link, 'Enter on a row with no closed chip links').toHaveBeenCalledWith(t.left(0))
  })

  /** Two chips on a row: the open one folds first, or opening both and folding one strands the other. */
  it('folds back the open chip on a row that holds a closed one too', () => {
    const { body, toggle } = mount()
    const t = new Tree(wireOf('g (\\f. \\x. f x) (\\f. \\x. f (f x))'))
    const one = t.right(t.left(0))
    const two = t.right(0)
    body.showTree(t, codeLines(t, { width: 80, vars: 'names', open: (i) => i !== one }), false, [], false)
    expect(rows().map(shown)).toEqual(['g 1 (λf x. f (f x))'])
    expect(rows()[0]?.querySelector<HTMLElement>('.term-gutter')?.dataset.node).toBe(String(two))
    body.el.focus()
    keyOnBody(body, 'ArrowLeft')
    keyOnBody(body, 'ArrowRight')
    expect(toggle.mock.calls).toEqual([[two], [one]])
  })

  /**
   * A CHIP AT THE HEAD OF AN APPLICATION'S OWN ROW. The row's `▸`/`▾` is the application's — the layout gives
   * a row to the outermost node that starts on it — so ← folds a chip opened there before the application,
   * as → opened it after.
   */
  it('folds a chip opened on its application’s own row before the application', () => {
    const { body, toggle } = mount()
    const t = new Tree(wireOf('(\\f. \\x. f (f x)) a b c d e f g h'))
    let chip = 0
    while (t.chip(chip) === null) chip = t.left(chip)
    body.showTree(t, codeLines(t, { width: 12, vars: 'names', open: (i) => t.chip(i) === null }), false, [], false)
    expect(shown(rows()[0] as HTMLElement)).toBe('2')
    expect(rows()[0]?.querySelector<HTMLElement>('.term-gutter')?.dataset.node).toBe('0')
    body.el.focus()
    keyOnBody(body, 'ArrowRight')
    expect(toggle.mock.calls).toEqual([[chip]])

    toggle.mockClear()
    body.showTree(t, codeLines(t, { width: 12, vars: 'names', open: () => true }), false, [], false)
    expect(shown(rows()[0] as HTMLElement)).toBe('(λf x. ')
    keyOnBody(body, 'ArrowLeft')
    expect(toggle.mock.calls, 'the chip, not the application').toEqual([[chip]])
  })

  /**
   * A HEAD OPENED ON ITS APPLICATION'S ROW FOLDS BACK WITH ←. Opened, a λ head too wide for the row still
   * starts on its application's row — the layout gives a row to the outermost node that starts on it — so ←
   * would reach only the application, and only "reset folds" would fold the head again: the redex path's shape
   * whenever its head is over 200 nodes. The row's `▾` stays the application's.
   */
  it('folds a head opened on its application’s row before the application', () => {
    const { body, toggle } = mount()
    const t = new Tree(wireOf('(\\x. x a b c d e f g h) z'))
    const head = t.left(0)
    body.showTree(t, codeLines(t, { width: 12, vars: 'names', open: () => true }), false, [], false)
    expect(rows().map(shown)).toEqual(['(λx. ', 'x', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h)', 'z'])
    expect(rows()[0]?.querySelector<HTMLElement>('.term-gutter')?.dataset.node, 'the application’s').toBe('0')
    body.el.focus()
    keyOnBody(body, 'Home')
    keyOnBody(body, 'ArrowLeft')
    expect(toggle.mock.calls, 'the head, not the application').toEqual([[head]])
  })

  it('keeps following when a shorter term clamps the scroll position', () => {
    const { body } = mount()
    const t = new Tree(wireOf(long(400)))
    body.showTree(t, codeLines(t, opts(20)), false, [], false)
    expect(body.el.scrollTop).toBeGreaterThan(0)
    const short = new Tree(wireOf('\\f. \\x. f (f x)'))
    body.showTree(short, codeLines(short, opts(20)), false, [], false)
    body.el.dispatchEvent(new Event('scroll'))
    expect(body.following).toBe(true)
    body.showTree(t, codeLines(t, opts(20)), false, [], false)
    expect(body.el.scrollTop).toBeGreaterThan(0)
  })

  /**
   * A FLAT RENDER IS NOT THE USER SCROLLING. Every recompile, refused step and rebind to a session with no
   * tree yet shows flat text between two trees; the spacer goes, the browser clamps `scrollTop` and reports
   * the clamp as a `scroll` a frame later. Real frames, not a synthetic event: the clamp's own event is the
   * one under test.
   */
  it('keeps following through a flat interlude, and follows the next tree', async () => {
    const { body } = mount()
    const t = new Tree(wireOf(long(400)))
    body.showTree(t, codeLines(t, opts(20)), false, [], false)
    await frames()
    const followed = body.el.scrollTop
    expect(followed).toBeGreaterThan(0)
    const frame: LambdaState = {
      text: 'λx. x',
      spans: new Uint8Array(),
      cut: null,
      step: 3,
      redex_span: null,
      owner: 'None',
    }
    body.showText(frame, null)
    await frames()
    expect(body.el.scrollTop, 'the flat text is one line, so the browser clamped').toBe(0)
    expect(body.following, 'through the flat text').toBe(true)
    body.showTree(t, codeLines(t, opts(20)), false, [], false)
    await frames()
    expect(body.following, 'on the next tree').toBe(true)
    expect(body.el.scrollTop).toBe(followed)
    expect(document.querySelector('.lambda-body-fixture .term-mark.is-next-redex')).not.toBeNull()
  })

  /**
   * A KEY THAT SCROLLS IS THE USER TAKING CONTROL. `Follow` hears of a scroll only when its event arrives, a
   * frame later, so a key that wrote `scrollTop` and then redrew would be put straight back on the redex: on any
   * term taller than the view the keyboard could not leave it. And the first draw of such a term follows
   * the redex far down, past the row the cursor starts on, so the active row has to come with the view.
   */
  it('lets a key move the view off the redex, and always names a drawn row as the active one', async () => {
    const { body } = mount()
    const t = new Tree(wireOf(long(400)))
    body.showTree(t, codeLines(t, opts(20)), false, [], false)
    await frames()
    expect(body.el.scrollTop).toBeGreaterThan(0)
    const active = () => {
      const id = body.el.getAttribute('aria-activedescendant')
      return id === null ? null : document.getElementById(id)
    }
    expect(active(), 'the first draw, followed far down').not.toBeNull()
    expect(active()?.classList.contains('is-active')).toBe(true)
    const followed = body.el.scrollTop
    body.el.focus()

    body.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await frames()
    expect(body.following, 'a move inside the view is not a scroll').toBe(true)
    expect(body.el.scrollTop).toBe(followed)

    body.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(body.el.scrollTop).toBe(0)
    expect(body.following).toBe(false)
    expect(active()?.dataset.line).toBe('0')
    await frames()
    body.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await frames()
    expect(body.el.scrollTop, 'still where the keys put it').toBe(0)
    expect(active()?.dataset.line).toBe('1')
  })

  /**
   * **A SCROLL OF THE USER'S THAT A PAINT COMES BEFORE IS STILL THE USER'S, WHERE THE PAINT RESIZED NOTHING.** A
   * scroll made on the main thread is reported with the next rendering update, and any draw of the page before then
   * paints this body. `#paint` records the position it finds as a clamp of its own only when it changed the spacer's
   * height; recorded at every paint, the `scroll` that followed would read as the body's own, and a body the user had
   * scrolled would go on following.
   *
   * **A TERM WITH NO REDEX, SINCE A PAINT WITH ONE TO CENTRE WRITES THE POSITION ITSELF** and the scroll is lost
   * either way. With none, as on a run's last step, nothing writes, and the scroll's own event is what is left to say
   * whose it was. The scroll is `scrollTop`, set as a key or a scrollbar sets it; its event is the browser's own.
   */
  it('lets a scroll take control when a paint that resized nothing comes before its event', async () => {
    const { body } = mount()
    const still = `f ${Array.from({ length: 400 }, (_, i) => `a${i}`).join(' ')}`
    const t = new Tree(wireOf(still))
    expect(t.wire.nextRedex, 'precondition: the term has no redex').toBeNull()
    const lines = codeLines(t, opts(20))
    body.showTree(t, lines, false, [], false)
    await frames()
    expect(body.el.scrollHeight - body.el.clientHeight, 'precondition: the body scrolls').toBeGreaterThan(200)
    expect(body.following, 'precondition: the body is following').toBe(true)
    body.el.scrollTop = 200
    body.showTree(t, lines, false, [], false)
    await frames()
    expect(body.el.scrollTop, 'precondition: the scroll stood').toBe(200)
    expect(body.following, 'the paint took the user’s scroll for its own').toBe(false)
  })

  it('draws only the rows in view, and follows the next redex until the user scrolls away', () => {
    const { body } = mount()
    const t = new Tree(wireOf(long(400)))
    const lines = codeLines(t, opts(20))
    expect(lines.length).toBeGreaterThan(400)
    body.showTree(t, lines, false, [], false)
    expect(rows().length).toBeLessThan(lines.length)
    expect(body.el.scrollTop).toBeGreaterThan(0)
    expect(document.querySelector('.lambda-body-fixture .term-mark.is-next-redex')).not.toBeNull()
    body.el.scrollTop = 0
    body.el.dispatchEvent(new Event('scroll'))
    expect(body.following).toBe(false)
    body.attach()
    expect(body.following).toBe(true)
    expect(body.el.scrollTop).toBeGreaterThan(0)
  })
})

describe('LambdaBody marks', () => {
  /** `TALL` with the root the next redex and linked, and node 5 the contractum: all three over several rows. */
  const tall = (width = 640) => {
    const { body } = mount(width)
    const t = new Tree(wireOf(TALL, { nextRedex: 0, contractum: 5 }))
    const lines = codeLines(t, opts(20))
    body.showTree(t, lines, false, [0], false)
    expect(lines.length, 'precondition: the fixture’s rows').toBe(9)
    expect(rows().length, 'precondition: every row is drawn').toBe(lines.length)
    return { body, t }
  }

  it('marks a node over several rows with one bar piece per row in its lane, and boxes no word', () => {
    const { body } = tall()
    expect(barRows(body.el, 'next-redex', LANES)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(barRows(body.el, 'linked', LANES)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(barRows(body.el, 'contractum', LANES)).toEqual([2, 3, 4, 5, 6, 7])
    expect(edged()).toEqual([])
  })

  it.each(WIDTHS)('draws no bar piece over a word, and moves no word, in a $host px body', ({ host, lanes }) => {
    const { body } = mount(host)
    const plain = new Tree(wireOf(TALL))
    body.showTree(plain, codeLines(plain, opts(20)), false, [], false)
    expect(document.querySelector('.lambda-body-fixture .term-bar'), 'precondition: nothing marked').toBeNull()
    expect(stripWidth(body.el), 'the strip, with no mark showing').toBe(lanes)
    const lefts = () => rows().map((r) => [...r.querySelectorAll('[data-node]')].map((s) => box(s).left))
    const before = lefts()
    body.el.parentElement?.remove()
    expect(stripWidth(tall(host).body.el)).toBe(lanes)
    expect(lefts()).toEqual(before)
    expect(document.querySelectorAll('.lambda-body-fixture .term-bar')).toHaveLength(24)
    for (const row of rows()) {
      const words = [...row.querySelectorAll('span:not(.term-lanes, .term-bar)')].map(box)
      for (const p of row.querySelectorAll('.term-bar')) {
        for (const w of words) expect(overlaps(box(p), w), `a piece on row ${row.dataset.line} over a word`).toBe(false)
      }
    }
  })

  it('takes the strip off the layout’s width, so the widest row it allows ends 2ch inside the view', () => {
    const { body } = mount()
    const width = body.columns()
    expect(width, 'precondition: wider than the floor').toBeGreaterThan(24)
    const t = new Tree(wireOf('v'.repeat(width)))
    body.showTree(t, codeLines(t, opts(width)), false, [], false)
    expect(rows(), 'precondition: one row').toHaveLength(1)
    const row = rows()[0] as HTMLElement
    const word = box(row.querySelector('[data-node]:not(.term-gutter)') as Element)
    const ch = word.width / width
    expect(box(row).right - word.right, 'room left at the row’s end').toBeGreaterThanOrEqual(2 * ch - 0.5)
  })

  it('takes the narrow strip off the layout’s width only where the wide one would leave the layout at its floor', () => {
    const { body } = mount()
    const probe = new Tree(wireOf('v'.repeat(40)))
    body.showTree(probe, codeLines(probe, opts(80)), false, [], false)
    const ch = box(rows()[0]?.querySelector('[data-node]:not(.term-gutter)') as Element).width / 40
    // Half a column inside the widths where the narrow strip leaves room for 25 columns and the wide one for 24.
    ;(body.el.parentElement as HTMLElement).style.width = `${Math.round(NARROW_LANES + 29.5 * ch)}px`
    const fits = (lanes: number) => Math.floor((body.el.clientWidth - lanes) / ch) - 4
    expect(fits(LANES), 'precondition: the wide strip leaves the layout at its floor').toBeLessThanOrEqual(24)
    const width = body.columns()
    expect(width, 'the narrow strip taken off').toBe(fits(NARROW_LANES))
    expect(width, 'precondition: past the floor').toBeGreaterThan(24)
    const t = new Tree(wireOf('v'.repeat(width)))
    body.showTree(t, codeLines(t, opts(width)), false, [], false)
    expect(stripWidth(body.el), 'the strip drawn').toBe(NARROW_LANES)
    const row = rows()[0] as HTMLElement
    const word = box(row.querySelector('[data-node]:not(.term-gutter)') as Element)
    expect(box(row).right - word.right, 'room left at the row’s end').toBeGreaterThanOrEqual(2 * ch - 0.5)
    // Half a column inside the widths where the wide strip leaves room for 25 columns, one past the floor.
    ;(body.el.parentElement as HTMLElement).style.width = `${Math.round(LANES + 29.5 * ch)}px`
    expect(fits(LANES), 'precondition: the wide strip leaves room past the floor').toBe(25)
    expect(body.columns(), 'the wide strip taken off').toBe(25)
    body.showTree(t, codeLines(t, opts(25)), false, [], false)
    expect(stripWidth(body.el), 'the strip drawn past the floor').toBe(LANES)
  })

  it('does not scroll sideways in a body the wide strip would push a first row as long as the default’s past', async () => {
    const { body } = mount()
    const t = new Tree(wireOf(FIRST, { nextRedex: 0 }))
    body.showTree(t, codeLines(t, opts(24)), false, [], false)
    expect(rows().map(shown), 'precondition: the rows').toEqual(['(λs. s a0 a1 a2 a3)', '(b0 b1)'])
    const first = [...(rows()[0] as HTMLElement).querySelectorAll('[data-node]:not(.term-gutter)')].map(box)
    const ch = (Math.max(...first.map((b) => b.right)) - Math.min(...first.map((b) => b.left))) / 19
    // The widest body the row and its gutter would overflow beside the wide strip.
    ;(body.el.parentElement as HTMLElement).style.width = `${Math.ceil(LANES + 21 * ch) - 1}px`
    await frames()
    expect(stripWidth(body.el), 'the strip').toBe(NARROW_LANES)
    expect(barRows(body.el, 'next-redex', NARROW_LANES), 'precondition: the root marked').toEqual([0, 1])
    const end = Math.max(...tokens().map((k) => box(k).right)) - box(body.el).left - body.el.clientLeft
    expect(end - NARROW_LANES + LANES, 'precondition: the wide strip would push it past the view').toBeGreaterThan(
      body.el.clientWidth,
    )
    expect(body.el.scrollWidth - body.el.clientWidth, 'sideways scroll').toBe(0)
  })

  it('keeps every bar piece in the view’s strip when the term scrolls sideways, over the words it scrolls past', async () => {
    const { body } = tall()
    ;(body.el.parentElement as HTMLElement).style.width = '40px'
    await frames()
    const lanes = stripWidth(body.el)
    expect(lanes, 'the strip in a narrow view').toBe(NARROW_LANES)
    expect(body.el.scrollWidth, 'precondition: rows wider than the view').toBeGreaterThan(body.el.clientWidth + lanes)
    body.el.scrollLeft = body.el.scrollWidth
    // Past where the shortest row's words end, less the strip: as far as a row only as wide as its words would
    // hold its strip in view.
    const ends = rows().map((r) => box([...r.querySelectorAll('[data-node]')].at(-1) as Element).right - box(r).left)
    expect(body.el.scrollLeft, 'precondition: scrolled past the shortest row').toBeGreaterThan(
      Math.min(...ends) - lanes,
    )
    const left = box(body.el).left + body.el.clientLeft
    const pieces = [...document.querySelectorAll('.lambda-body-fixture .term-bar')]
    expect(pieces, 'precondition: all three lanes').toHaveLength(24)
    for (const p of pieces) {
      expect([box(p).left >= left, box(p).right <= left + lanes], 'a piece in the view’s strip').toEqual([true, true])
    }
    const under = tokens().filter((t) => box(t).left < left + lanes - 1 && box(t).right > left + 1)
    expect(under.length, 'precondition: words scrolled under the strip').toBeGreaterThan(0)
    for (const t of under) {
      const x = Math.max(box(t).left, left) + 0.5
      const hit = document.elementFromPoint(x, box(t).top + box(t).height / 2) as Element
      expect(t.contains(hit), `word ${t.dataset.node} drawn over the strip`).toBe(false)
      expect(getComputedStyle(hit).backgroundColor, 'what covers it is opaque').toMatch(/^rgb\(/)
    }
  })

  it('draws the focus ring on the active row’s strip, still at the view’s left when the term scrolls sideways', async () => {
    const { body } = tall()
    const before = document.createElement('button')
    body.el.before(before)
    before.focus()
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement, 'precondition: Tab reaches the body').toBe(body.el)
    expect(body.el.matches(':focus-visible'), 'precondition: a key’s focus').toBe(true)
    const found = document.getElementById(body.el.getAttribute('aria-activedescendant') ?? '')
    expect(found?.isConnected, 'precondition: the active row is drawn').toBe(true)
    const active = found as HTMLElement
    const ringed = rows().filter((r) =>
      / inset$|^inset /.test(getComputedStyle(r.firstElementChild as Element).boxShadow),
    )
    expect(ringed, 'the active row’s strip, and only it, ringed').toEqual([active])
    ;(body.el.parentElement as HTMLElement).style.width = '40px'
    await frames()
    // The narrow strip redraws the rows, the active one with them.
    const now = document.getElementById(body.el.getAttribute('aria-activedescendant') ?? '') as HTMLElement
    expect(now.dataset.line, 'precondition: the same row active').toBe(active.dataset.line)
    body.el.scrollLeft = body.el.scrollWidth
    const end = box([...now.querySelectorAll('[data-node]')].at(-1) as Element).right - box(now).left
    expect(body.el.scrollLeft, 'precondition: scrolled past the active row’s words').toBeGreaterThan(end - NARROW_LANES)
    expect(/ inset$|^inset /.test(getComputedStyle(now.firstElementChild as Element).boxShadow), 'ringed').toBe(true)
    const strip = box(now.firstElementChild as Element)
    expect(strip.width, 'the strip’s width').toBeCloseTo(NARROW_LANES)
    expect(strip.left, 'the strip at the view’s left').toBeCloseTo(box(body.el).left + body.el.clientLeft)
  })

  it.each(WIDTHS)(
    'draws a link as a bracket, the next redex dashed and the contractum solid, each in a lane of its own, in a $host px body',
    async ({ host, lanes }) => {
      const { body } = tall(host)
      expect(stripWidth(body.el), 'the strip').toBe(lanes)
      for (const lane of LANE_ORDER)
        expect(barRows(body.el, lane, lanes).length, `${lane} in the strip`).toBeGreaterThan(1)
      const link = barPieces(body.el, 'linked')
      for (const [i, p] of link.entries()) {
        const s = getComputedStyle(p)
        const ends = [i === 0, i === link.length - 1]
        expect(s.borderLeftStyle).toBe('solid')
        expect([drawsEdge(s, 'Top'), drawsEdge(s, 'Bottom')], `link piece ${i}`).toEqual(ends)
        if (ends.includes(true)) {
          expect(box(p).width, 'the tick reaches past the line').toBeGreaterThan(Number.parseFloat(s.borderLeftWidth))
        }
      }
      for (const p of barPieces(body.el, 'next-redex')) {
        const s = getComputedStyle(p)
        expect(s.backgroundImage, 'dashes with gaps').toMatch(/gradient\(.*rgba\(0, 0, 0, 0\)/)
        expect(s.backgroundRepeat).toBe('repeat-y')
        expect(Number.parseFloat(s.backgroundSize.split(' ')[1] ?? ''), 'a dash shorter than the piece').toBeLessThan(
          box(p).height / 2,
        )
      }
      const dash = barPieces(body.el, 'next-redex')[0] as HTMLElement
      const ds = getComputedStyle(dash)
      const phase =
        box(dash).top - box(dash.closest('.term-line') as Element).top + Number.parseFloat(ds.backgroundPositionY)
      expect(
        phase % Number.parseFloat(ds.backgroundSize.split(' ')[1] ?? ''),
        'the first piece’s dashes on the rows’ grid',
      ).toBe(0)
      for (const p of barPieces(body.el, 'contractum')) {
        const s = getComputedStyle(p)
        expect(s.backgroundImage).toBe('none')
        expect(s.backgroundColor).toMatch(/^rgb\(/)
      }
      const firsts = LANE_ORDER.map((l) => box(barPieces(body.el, l)[0] as HTMLElement))
      for (const [a, b] of [firsts.slice(0, 2), firsts.slice(1)]) {
        expect(a?.right, 'the lanes apart, in order').toBeLessThanOrEqual(b?.left ?? 0)
      }
      // A node's first and last pieces stop short of their rows' edges, so two marked nodes stacked read as two.
      for (const lane of LANE_ORDER) {
        const ps = barPieces(body.el, lane)
        const row = (p: HTMLElement | undefined) => box(p?.closest('.term-line') as Element)
        const [first, last] = [box(ps[0] as HTMLElement), box(ps.at(-1) as HTMLElement)]
        expect(first.top, lane).toBeGreaterThan(row(ps[0]).top)
        expect(first.bottom, lane).toBe(row(ps[0]).bottom)
        expect(last.top, lane).toBe(row(ps.at(-1)).top)
        expect(last.bottom, lane).toBeLessThan(row(ps.at(-1)).bottom)
        for (const p of ps.slice(1, -1)) expect([box(p).top, box(p).bottom], lane).toEqual([row(p).top, row(p).bottom])
      }
      // The ring is drawn on the active row's strip, where the first lane is: the two may touch, not overlap. It
      // reaches as far as its offset, its spread and its blur together.
      const before = document.createElement('button')
      body.el.before(before)
      before.focus()
      await userEvent.keyboard('{Tab}{ArrowDown}{ArrowDown}')
      expect(body.el.matches(':focus-visible'), 'precondition: a key’s focus').toBe(true)
      const active = document.getElementById(body.el.getAttribute('aria-activedescendant') ?? '') as HTMLElement
      const strip = active.firstElementChild as Element
      const first = active.querySelector(`.term-bar[data-lane="${LANE_ORDER[0]}"]`)
      expect(first, 'precondition: the first lane drawn on the active row').not.toBeNull()
      const ring = Math.max(...shadows(getComputedStyle(strip)).map((l) => (l[0] ?? 0) + (l[3] ?? 0) + (l[2] ?? 0)))
      expect(ring, 'precondition: the active row’s strip ringed').toBeGreaterThan(0)
      expect(box(first as Element).left - box(strip).left, 'the first lane past the ring').toBeGreaterThanOrEqual(ring)
    },
  )

  it.each(WIDTHS)(
    'draws nested linked copies as one line, a corner at each outer end and a tee at each inner end, in a $host px body',
    ({ host, lanes }) => {
      const { body } = mount(host)
      const t = new Tree(wireOf(TALL))
      // The root, rows 0-8, holds node 5, rows 2-7.
      body.showTree(t, codeLines(t, opts(20)), false, [0, 5], false)
      expect(rows().length, 'precondition: the fixture’s rows').toBe(9)
      expect(stripWidth(body.el), 'the strip').toBe(lanes)
      expect(barRows(body.el, 'linked', lanes), 'one piece per row').toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
      const shape = linkShape(body.el)
      const inset = shape[0]?.[1] ?? 0
      expect(inset, 'a corner stops short of its row’s top').toBeGreaterThan(0)
      const plain = (line: number) => [line, 0, false, 0, false]
      expect(shape).toEqual([
        [0, inset, true, 0, false],
        plain(1),
        [2, 0, true, 0, false],
        ...[3, 4, 5, 6].map(plain),
        [7, 0, false, 0, true],
        [8, 0, false, inset, true],
      ])
      const names = rows().map((r) => computeAccessibleName(r, { computedStyleSupportsPseudoElements: true }))
      expect(
        names.flatMap((n, i) => (n.includes('linked:') ? [i] : [])),
        'each copy’s words',
      ).toEqual([0, 2])
    },
  )

  it('draws two linked copies on rows one after the other as two brackets, each with its own corners', () => {
    const { body } = mount()
    const t = new Tree(wireOf(PAIR))
    const lines = codeLines(t, opts(12))
    expect(
      [rowsOf(t, lines, 3), rowsOf(t, lines, 14)],
      'precondition: node 14 starts on the row after node 3 ends',
    ).toEqual([
      [1, 2, 3, 4, 5, 6],
      [7, 8, 9, 10, 11, 12],
    ])
    body.showTree(t, lines, false, [3, 14], false)
    expect(barRows(body.el, 'linked', LANES)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const shape = linkShape(body.el)
    const inset = shape[0]?.[1] ?? 0
    expect(inset, 'a corner stops short of its row’s top').toBeGreaterThan(0)
    const plain = (line: number) => [line, 0, false, 0, false]
    expect(shape).toEqual([
      [1, inset, true, 0, false],
      ...[2, 3, 4, 5].map(plain),
      [6, 0, false, inset, true],
      [7, inset, true, 0, false],
      ...[8, 9, 10, 11].map(plain),
      [12, 0, false, inset, true],
    ])
  })

  it('draws two linked copies that meet on a row as one line through it, the first’s end tick under the next’s', () => {
    const { body } = mount()
    const t = new Tree(wireOf(PAIR))
    const laid = codeLines(t, opts(12))
    // A layout where one copy ends on the row the next starts on: the rows the two meet on, made one.
    const met = { ...(laid[6] as Line), tokens: [...(laid[6] as Line).tokens, ...(laid[7] as Line).tokens] }
    const lines = [...laid.slice(0, 6), met, ...laid.slice(8)]
    expect(
      [rowsOf(t, lines, 3), rowsOf(t, lines, 14)],
      'precondition: node 3 ends on the row node 14 starts on',
    ).toEqual([
      [1, 2, 3, 4, 5, 6],
      [6, 7, 8, 9, 10, 11],
    ])
    body.showTree(t, lines, false, [3, 14], false)
    expect(barRows(body.el, 'linked', LANES), 'one piece per row').toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    const shape = linkShape(body.el)
    const inset = shape[0]?.[1] ?? 0
    expect(inset, 'a corner stops short of its row’s top').toBeGreaterThan(0)
    const plain = (line: number) => [line, 0, false, 0, false]
    expect(shape).toEqual([
      [1, inset, true, 0, false],
      ...[2, 3, 4, 5].map(plain),
      [6, 0, true, 0, true],
      ...[7, 8, 9, 10].map(plain),
      [11, 0, false, inset, true],
    ])
  })

  it('draws a one-row node’s mark as one shape round its words and no others', () => {
    const { body } = mount()
    const t = new Tree(wireOf(ROW))
    body.showTree(t, codeLines(t, opts(80)), false, [7], false)
    expect(rows(), 'precondition: one row').toHaveLength(1)
    const shapes = edged()
    expect(shapes).toHaveLength(2)
    for (const node of [3, 7]) {
      const mine = tokens().filter((k) => t.contains(node, Number(k.dataset.node)))
      expect(mine.length, 'precondition: the node has words').toBeGreaterThan(2)
      const round = shapes.filter((e) => tokens().every((k) => encloses(box(e), box(k)) === mine.includes(k)))
      expect(round, `node ${node}`).toHaveLength(1)
    }
  })

  it('draws both marks on one row’s node: both grounds, the link’s box and the underline', () => {
    const { body } = mount()
    const t = new Tree(wireOf(ROW, { contractum: 7 }))
    body.showTree(t, codeLines(t, opts(80)), false, [7], false)
    const both = edged().filter((e) => getComputedStyle(e).outlineStyle === 'none')
    expect(both).toHaveLength(1)
    const s = getComputedStyle(both[0] as HTMLElement)
    expect(s.backgroundImage, 'the contractum’s ground').toContain('gradient')
    expect(s.backgroundColor, 'the link’s ground').not.toBe('rgba(0, 0, 0, 0)')
    const [boxed, under] = [shadows(s).filter((l) => (l[3] ?? 0) > 0), shadows(s).filter((l) => (l[1] ?? 0) < 0)]
    expect([boxed.length, under.length], s.boxShadow).toEqual([1, 1])
  })

  it('draws the next redex’s outline clear of a link’s box, on one node or either holding the other', () => {
    const { body } = mount()
    const t = new Tree(wireOf(ROW))
    // The link on the redex itself, on `k ((λy. y) z)` round it, and on `z` inside it.
    for (const link of [3, 1, 6]) {
      body.showTree(t, codeLines(t, opts(80)), false, [link], false)
      const shapes = edged()
      const dashed = shapes.filter((e) => getComputedStyle(e).outlineStyle === 'dashed')
      const boxed = shapes.filter((e) => getComputedStyle(e).boxShadow !== 'none')
      expect([dashed.length, boxed.length], `link ${link}`).toEqual([1, 1])
      const o = getComputedStyle(dashed[0] as HTMLElement)
      const top = box(boxed[0] as HTMLElement).top
      expect(box(dashed[0] as HTMLElement).top, 'precondition: one row’s runs share its top').toBeCloseTo(top)
      const inner = box(dashed[0] as HTMLElement).top - Number.parseFloat(o.outlineOffset)
      const spread = Math.max(...shadows(getComputedStyle(boxed[0] as HTMLElement)).map((l) => l[3] ?? 0))
      const outer = inner - Number.parseFloat(o.outlineWidth)
      expect(inner <= top || outer >= top + spread, `link ${link}: the outline over the box`).toBe(true)
    }
  })

  it('says a mark’s words once, in the name of the row its node starts on, before its first word', () => {
    tall()
    const names = rows().map((r) => computeAccessibleName(r, { computedStyleSupportsPseudoElements: true }))
    const says = (words: string) => names.flatMap((n, i) => (n.includes(words) ? [i] : []))
    expect(says('next redex:')).toEqual([0])
    expect(says('linked:')).toEqual([0])
    expect(says('just produced:')).toEqual([2])
    expect(names[0]).toMatch(/^next redex: linked: g$/)
    expect(names[2]).toMatch(/^\(just produced: f$/)
  })

  it('draws a piece on every drawn row of a node longer than the window, scrolled to its end', async () => {
    const { body } = mount()
    const t = new Tree(wireOf(long(400), { nextRedex: 0 }))
    const lines = codeLines(t, opts(20))
    body.showTree(t, lines, false, [0], false)
    body.el.scrollTop = body.el.scrollHeight
    body.el.dispatchEvent(new Event('scroll'))
    await frames()
    const drawn = rows().map((r) => Number(r.dataset.line))
    expect(drawn.at(-1), 'precondition: the last row is drawn').toBe(lines.length - 1)
    expect(drawn[0], 'precondition: the first row is not').toBeGreaterThan(0)
    expect(barRows(body.el, 'next-redex', LANES)).toEqual(drawn)
    expect(barRows(body.el, 'linked', LANES)).toEqual(drawn)
    const link = barPieces(body.el, 'linked')
    const ticks = link.map((p) => [drawsEdge(getComputedStyle(p), 'Top'), drawsEdge(getComputedStyle(p), 'Bottom')])
    expect(ticks).toEqual(drawn.map((_, i) => [false, i === drawn.length - 1]))
    expect(edged()).toEqual([])
  })
})
