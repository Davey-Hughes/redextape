import { afterEach, describe, expect, it, vi } from 'vitest'
import { LambdaBody, LINE_HEIGHT } from '../../src/lambda-body'
import { codeLines, type LayoutOptions, outlineLines } from '../../src/lambda-layout'
import { Tree } from '../../src/lambda-tree'
import type { LambdaState } from '../../src/types'
import { wireOf } from '../node/tree-fixture'

const opts = (width: number): LayoutOptions => ({ width, vars: 'names', open: () => true })

function mount() {
  const toggle = vi.fn()
  const link = vi.fn()
  const body = new LambdaBody({ toggle, link })
  const host = document.createElement('section')
  host.className = 'pane lambda-body-fixture'
  host.style.width = '640px'
  host.append(body.el)
  document.body.append(host)
  return { body, toggle, link }
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture .term-line')]
/** A row's text: its tokens — the gutter and the marks' words are CSS, not text. */
const shown = (row: HTMLElement) => row.textContent ?? ''

/** `f a0 a1 … a{n-1}`, then a redex last — a spine that breaks one argument per line at a narrow width. */
const long = (n: number) => `f ${Array.from({ length: n }, (_, i) => `a${i}`).join(' ')} ((\\y. y) z)`

/** Two animation frames: long enough for the browser to lay out, clamp and deliver its own `scroll` events. */
const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

const press = (body: LambdaBody, key: string) =>
  body.el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

afterEach(() => {
  for (const el of document.querySelectorAll('.lambda-body-fixture')) el.remove()
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
    const redex = [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture .is-next-redex')]
    expect(redex.map((s) => s.textContent).join('')).toBe('((λy. y) z)')
    expect(getComputedStyle(redex[0] as HTMLElement).outlineStyle).toBe('dashed')
    const made = [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture .is-contractum')]
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
    const linked = [...document.querySelectorAll('.lambda-body-fixture .is-linked')].map((s) => s.textContent).join('')
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
    const frame: LambdaState = { text: 'λx. x', spans: [], cut: null, step: 3, redex_span: null, owner: 'None' }
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
      spans: [
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
      ],
      cut: null,
      step: 6,
      redex_span: { start: 5, end: 21 },
      owner: 'None',
    }
    body.showText(frame, null)
    const lit = [...body.el.querySelectorAll('.is-contractum')].map((e) => e.textContent).join('')
    expect(lit).toBe('(λx0.f(fx0))')
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
   * A CLICK MAKES ITS ROW THE ACTIVE ONE, AND PAINTS IT SO. The body set the active row and left the paint to
   * the redraw its event would bring; a click that links nothing brings none, so `.is-active` and
   * `aria-activedescendant` stayed on the row before.
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
   * "any fold on the row", the application showed `▸`, and ← and → each did the other's job.
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
    press(body, 'Home')
    press(body, 'ArrowRight')
    expect(toggle.mock.calls, '→ opens only what is closed').toEqual([[head]])
    press(body, 'ArrowLeft')
    expect(toggle).toHaveBeenLastCalledWith(0)
  })

  /**
   * ENTER OPENS WHAT → OPENS, LIKE ANY FOLD (spec §5.2: "A chip opens on click or Enter, like any fold"). A row
   * with anything closed on it — a `… N nodes` or a chip — opens the first of them, and only a row with nothing
   * closed links. Enter opened a chip and linked from every other row, so a folded row linked instead.
   */
  it('opens a folded row with Enter, as → does, and links only from a row with nothing closed', () => {
    const { body, toggle, link } = mount()
    const app = new Tree(wireOf('(\\x. x a b c d e f g h) z'))
    const head = app.left(0)
    body.showTree(app, codeLines(app, { width: 12, vars: 'names', open: (i) => i !== head }), false, [], false)
    body.el.focus()
    press(body, 'Home')
    press(body, 'Enter')
    expect(toggle.mock.calls, 'the folded head on its application’s row').toEqual([[head]])

    toggle.mockClear()
    const abs = new Tree(wireOf('\\x. f x x x x'))
    body.showTree(abs, codeLines(abs, { width: 8, vars: 'names', open: (i) => i !== 0 }), false, [], false)
    press(body, 'Home')
    press(body, 'Enter')
    expect(toggle.mock.calls, 'a folded abstraction').toEqual([[0]])
    expect(link, 'a row with something closed on it').not.toHaveBeenCalled()

    toggle.mockClear()
    body.showTree(abs, codeLines(abs, opts(8)), false, [], false)
    press(body, 'Home')
    press(body, 'Enter')
    expect(toggle, 'the same row, opened').not.toHaveBeenCalled()
    expect(link).toHaveBeenCalledWith(0)
  })

  /**
   * A CHIP OPENS BY KEY, LIKE ANY FOLD (spec §5.2). The layout gives a chip's row no disclosure — the chip is
   * one line, and so, opened, is a small numeral — so → returned early, Enter linked from it, and once open
   * nothing but "reset folds" could make it a chip again. A finished run's value is a root chip: the case.
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
    press(body, 'ArrowLeft')
    expect(toggle, '← on a closed chip').not.toHaveBeenCalled()
    press(body, 'ArrowRight')
    expect(toggle.mock.calls).toEqual([[0]])
    press(body, 'Enter')
    expect(toggle.mock.calls).toEqual([[0], [0]])
    expect(link, 'Enter on a chip opens it').not.toHaveBeenCalled()

    toggle.mockClear()
    body.showTree(t, codeLines(t, { width: 80, vars: 'names', open: () => true }), false, [], false)
    expect(rows().map(shown)).toEqual(['λf x. f (f x)'])
    expect(row().getAttribute('aria-expanded')).toBe('true')
    expect(row().querySelector<HTMLElement>('.term-gutter')?.dataset.open).toBe('true')
    expect(row().querySelector<HTMLElement>('.term-gutter')?.title).toBe('fold')
    press(body, 'ArrowRight')
    expect(toggle, '→ with nothing closed').not.toHaveBeenCalled()
    press(body, 'ArrowLeft')
    expect(toggle.mock.calls).toEqual([[0]])
    press(body, 'Enter')
    expect(link, 'Enter on an open λ row links').toHaveBeenCalledWith(0)
    row().querySelector<HTMLElement>('.term-gutter')?.click()
    expect(toggle.mock.calls, 'and a pointer can fold it back too').toEqual([[0], [0]])
  })

  /**
   * A CHIP ANYWHERE ON ITS ROW, NOT ONLY FIRST. Numerals and booleans are mostly arguments: `g 2` is a row
   * whose first token is `g`. Read only at the first token, it had no `aria-expanded`, → opened the chip,
   * and nothing but "reset folds" made it a chip again.
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
    press(body, 'ArrowRight')
    press(body, 'Enter')
    expect(toggle.mock.calls).toEqual([[chip], [chip]])
    expect(link).not.toHaveBeenCalled()

    toggle.mockClear()
    body.showTree(t, codeLines(t, { width: 80, vars: 'names', open: () => true }), false, [], false)
    expect(rows().map(shown)).toEqual(['g (λf x. f (f x))'])
    expect(row().getAttribute('aria-expanded')).toBe('true')
    expect(gutter()?.dataset.open).toBe('true')
    press(body, 'ArrowLeft')
    gutter()?.click()
    expect(toggle.mock.calls).toEqual([[chip], [chip]])
    press(body, 'Enter')
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
    press(body, 'ArrowLeft')
    press(body, 'ArrowRight')
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
    press(body, 'ArrowRight')
    expect(toggle.mock.calls).toEqual([[chip]])

    toggle.mockClear()
    body.showTree(t, codeLines(t, { width: 12, vars: 'names', open: () => true }), false, [], false)
    expect(shown(rows()[0] as HTMLElement)).toBe('(λf x. ')
    press(body, 'ArrowLeft')
    expect(toggle.mock.calls, 'the chip, not the application').toEqual([[chip]])
  })

  /**
   * A HEAD OPENED ON ITS APPLICATION'S ROW FOLDS BACK WITH ←. Opened, a λ head too wide for the row still
   * starts on its application's row — the layout gives a row to the outermost node that starts on it — so ←
   * reached only the application, and only "reset folds" folded the head again: the redex path's shape
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
    press(body, 'Home')
    press(body, 'ArrowLeft')
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
    const frame: LambdaState = { text: 'λx. x', spans: [], cut: null, step: 3, redex_span: null, owner: 'None' }
    body.showText(frame, null)
    await frames()
    expect(body.el.scrollTop, 'the flat text is one line, so the browser clamped').toBe(0)
    expect(body.following, 'through the flat text').toBe(true)
    body.showTree(t, codeLines(t, opts(20)), false, [], false)
    await frames()
    expect(body.following, 'on the next tree').toBe(true)
    expect(body.el.scrollTop).toBe(followed)
    expect(document.querySelector('.lambda-body-fixture .is-next-redex')).not.toBeNull()
  })

  /**
   * A KEY THAT SCROLLS IS THE USER TAKING CONTROL. `Follow` hears of a scroll only when its event arrives, a
   * frame later, so a key that wrote `scrollTop` and then redrew was put straight back on the redex: on any
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

  it('draws only the rows in view, and follows the next redex until the user scrolls away', () => {
    const { body } = mount()
    const t = new Tree(wireOf(long(400)))
    const lines = codeLines(t, opts(20))
    expect(lines.length).toBeGreaterThan(400)
    body.showTree(t, lines, false, [], false)
    expect(rows().length).toBeLessThan(lines.length)
    expect(body.el.scrollTop).toBeGreaterThan(0)
    expect(document.querySelector('.lambda-body-fixture .is-next-redex')).not.toBeNull()
    body.el.scrollTop = 0
    body.el.dispatchEvent(new Event('scroll'))
    expect(body.following).toBe(false)
    body.attach()
    expect(body.following).toBe(true)
    expect(body.el.scrollTop).toBeGreaterThan(0)
  })
})
