import { type Line, lineOf, type Token } from './lambda-layout'
import type { Tree } from './lambda-tree'
import { byteIndexAt, byteToIndex, decorationRanges } from './spans'
import { Follow } from './state-table'
import { tokenClassName } from './theme'
import type { LambdaState } from './types'
import { visibleWindow } from './virtual-list'

/** One laid-out line's height, in CSS pixels — `.term-line`'s `height` in `style.css` says the same. */
export const LINE_HEIGHT = 20
/** Rows drawn past each edge of the viewport, so a short scroll never shows an empty band. */
const OVERSCAN = 6

/** What the λ view asks of its owner when a row is used. */
export type BodyEvents = {
  /** Open or fold `node` — a gutter `▸`/`▾`, a chip, or a `… N nodes` fold was clicked or keyed. */
  readonly toggle: (node: number) => void
  /** Link from `node` — any other token was clicked, or Enter was pressed on a row with nothing closed on it. */
  readonly link: (node: number) => void
  /** The body scrolled — the term map's viewport box moves with it. */
  readonly scrolled?: () => void
}

/**
 * The class a mark adds, and the words a screen reader hears where it starts.
 *
 * **THE WORDS ARE CSS GENERATED CONTENT, NOT TEXT NODES** (`[data-marks]::before { content: attr(…) }`,
 * visually hidden). Generated content is part of what a screen reader reads, and it is not part of
 * `textContent` — which every reader of `.term` reads. The prototype put them in hidden spans, and every
 * comparison of the λ view's text then depended on which marks were showing at that moment.
 */
const MARKS = {
  'is-next-redex': 'next redex:',
  'is-contractum': 'just produced:',
  'is-linked': 'linked:',
} as const
type Mark = keyof typeof MARKS

function tokenClass(tok: Token): string {
  switch (tok.kind) {
    case 'binder':
      return tokenClassName('Binder')
    case 'ident':
      return tokenClassName('Ident')
    case 'keyword':
      return tokenClassName('Keyword')
    case 'chip':
      return `term-chip ${tokenClassName(/^\d+$/.test(tok.text) ? 'Nat' : 'Bool')}`
    case 'fold':
      return 'term-fold'
    default:
      return tokenClassName('Punct')
  }
}

/**
 * The node a row's `▸`/`▾` opens or folds and whether it is open, or `null` for a row that discloses nothing.
 *
 * **OPEN IS THE DISCLOSED NODE'S STATE, NOT THE ROW'S.** An application whose head is too wide writes that
 * head's first line as its own (`codeLines`), so a folded head's `… N nodes` sits on the row of an open
 * application. Read as "any fold on the row", the application showed `▸` and ←/→ were inverted on it.
 *
 * **A ROW THE LAYOUT GIVES NO NODE DISCLOSES ITS CHIPS.** A chip is a fold with a label (spec §5.2), and one
 * line either way: closed it is its chip, and opened, a small numeral still fits the row it was on. So such a
 * row discloses the first chip on it that is open, or else the first that is closed — wherever it stands,
 * since numerals and booleans are mostly arguments (`g 2`). Open first, so that with two chips on a row,
 * opening both and folding one never strands the other open.
 *
 * **A ROW THE LAYOUT GIVES A NODE DISCLOSES THAT NODE,** and the head its application took the row from is
 * not it — a chip, or a λ that broke or is folded (`Line.inner`): the `▸`/`▾` stays the application's.
 * `#key`'s ← folds such a head, once opened, before the application; a pointer cannot, short of "reset folds".
 */
function disclosure(tree: Tree, line: Line): { node: number; open: boolean } | null {
  const node = line.disclose
  if (node >= 0) {
    return { node, open: !line.tokens.some((t) => t.node === node && (t.kind === 'fold' || t.kind === 'chip')) }
  }
  const chips = chipsOn(tree, line)
  return chips.find((c) => c.open) ?? chips[0] ?? null
}

/** The first thing closed on `line` — a `… N nodes` or a chip — which → and Enter open. */
function firstClosed(line: Line | undefined): Token | undefined {
  return line?.tokens.find((t) => t.kind === 'fold' || t.kind === 'chip')
}

/**
 * The chip-shaped nodes that start on `line`, in order, other than the node the row discloses: closed, a node
 * is its chip token; open, its `λ` or its `(`.
 *
 * **A `)` IS NOT A START.** `codeLines` closes a broken node's parenthesis on that node's last row, the one
 * place a node's token lands on a later row than its first; read as a chip there, a leaf row ending a broken
 * chip showed `▾`, said `aria-expanded`, and folded the chip from its closing line.
 */
function chipsOn(tree: Tree, line: Line): { node: number; open: boolean }[] {
  const out: { node: number; open: boolean }[] = []
  for (const t of line.tokens) {
    if (t.text === ')' || t.node === line.disclose || out.some((c) => c.node === t.node)) continue
    if (tree.chip(t.node) === null) continue
    out.push({ node: t.node, open: t.kind !== 'chip' })
  }
  return out
}

/**
 * A frame's recorded text as today's λ view drew it: token spans, the contractum marked, and the cut.
 * What the body shows before a step's tree arrives, and when the tree was refused.
 */
export function flatText(frame: LambdaState | null, note: string | null): Node[] {
  if (frame === null) return note === null ? [] : [document.createTextNode(note)]
  const ranges = decorationRanges(frame.spans, frame.text)
  let from = -1
  let to = -1
  if (frame.redex_span !== null) {
    const map = byteToIndex(frame.text)
    from = byteIndexAt(map, frame.redex_span.start)
    to = byteIndexAt(map, frame.redex_span.end)
  }
  const out: Node[] = []
  let at = 0
  for (const r of ranges) {
    if (r.from < at) continue
    if (r.from > at) out.push(document.createTextNode(frame.text.slice(at, r.from)))
    const el = document.createElement('span')
    el.className = to > from && r.from >= from && r.to <= to ? `${r.className} is-contractum` : r.className
    el.textContent = frame.text.slice(r.from, r.to)
    out.push(el)
    at = r.to
  }
  if (at < frame.text.length) out.push(document.createTextNode(frame.text.slice(at)))
  if (frame.cut !== null) {
    const more = document.createElement('span')
    more.className = 'truncated'
    more.textContent = frame.cut === 'Depth' ? ' … too deep' : ' … truncated'
    out.push(more)
  }
  if (note !== null) {
    const n = document.createElement('p')
    n.className = 'term-note'
    n.textContent = note
    out.push(n)
  }
  return out
}

let seq = 0

let canvas: CanvasRenderingContext2D | null | undefined
/** One 2D context for every body's width measurement, made on first use. */
function measurer(): CanvasRenderingContext2D | null {
  if (canvas === undefined) canvas = document.createElement('canvas').getContext('2d')
  return canvas
}

/**
 * The λ view's body: a laid-out term, virtualized by line, or a frame's flat text (spec §5).
 *
 * **ONE ELEMENT, `.term`, IN BOTH MODES.** Every test and every stylesheet rule that reads the λ term
 * reads `.term`; what changes between modes is what is inside it and which role it carries — `tree` for
 * either layout, `region` for flat text. `data-layout` says which is showing: `code`, `outline` or `flat`.
 *
 * **THE CODE LAYOUT IS A TREE TOO, NOT A LIST.** A roving cursor (`aria-activedescendant`) and
 * `aria-expanded` are not valid on a list's items, and its lines nest as the outline's rows do.
 *
 * **ONE TAB STOP.** The body is focusable and holds a roving active row (`aria-activedescendant`), so a
 * term of three thousand lines is not three thousand tab stops.
 *
 * **FOLLOWING IS `state-table.ts`'s `Follow`, REUSED.** The body keeps the next redex in view until a user
 * scroll detaches it; its own writes to `scrollTop` are recorded so their echoes are not read as intent.
 */
export class LambdaBody {
  readonly el: HTMLElement
  /**
   * Told when a re-attach starts or stops having anything to do: while a tree is shown and following it has
   * stopped. The view's `follow redex` action exists exactly then. Set by the view once it has built that
   * action, as `ScratchEditor.onEdit` is.
   */
  onDetached: ((detached: boolean) => void) | null = null
  /** What `onDetached` was last told, so it hears of a change and only of a change. */
  #told = false
  #spacer: HTMLElement
  #rows: HTMLElement
  #flat: HTMLElement
  #follow = new Follow()
  #on: BodyEvents
  #id = seq++
  #tree: Tree | null = null
  #lines: readonly Line[] = []
  #linked: readonly number[] = []
  #outline = false
  #active = 0
  #painted = ''

  constructor(on: BodyEvents) {
    this.#on = on
    this.el = document.createElement('div')
    this.el.className = 'term'
    this.el.tabIndex = 0
    this.el.setAttribute('aria-label', 'λ term')
    this.#flat = document.createElement('div')
    this.#flat.className = 'term-flat'
    this.#spacer = document.createElement('div')
    this.#spacer.className = 'term-spacer'
    this.#rows = document.createElement('div')
    this.#rows.className = 'term-rows'
    this.#spacer.append(this.#rows)
    this.el.append(this.#flat, this.#spacer)
    this.el.addEventListener('scroll', () => {
      this.#follow.onScroll(this.el.scrollTop)
      this.#paint()
      this.#on.scrolled?.()
    })
    this.el.addEventListener('click', (e) => this.#click(e))
    this.el.addEventListener('keydown', (e) => this.#key(e))
  }

  /**
   * Characters that fit one line at the body's current width — the layout's `width`.
   *
   * **MEASURED ON A CANVAS, NOT WITH A SPAN IN THE BODY.** A measuring span is text inside `.term`, and
   * every reader of the λ view reads `.term`'s text; the prototype's span put `0000000000` at the head of
   * every term it drew.
   */
  columns(): number {
    const ctx = measurer()
    if (ctx === null || this.el.clientWidth === 0) return 80
    ctx.font = getComputedStyle(this.el).font
    const ch = ctx.measureText('0000000000').width / 10
    if (!(ch > 0)) return 80
    return Math.max(24, Math.floor(this.el.clientWidth / ch) - 4)
  }

  get following(): boolean {
    return this.#follow.following
  }

  /** The lines on screen, first and last — what the term map outlines. */
  get visible(): { first: number; last: number } {
    const w = visibleWindow(this.#lines.length, LINE_HEIGHT, this.el.clientHeight, this.el.scrollTop, 0)
    return { first: w.firstIndex, last: w.lastIndex }
  }

  /** Follow the next redex again, and scroll to it now. */
  attach(): void {
    this.#follow.attach()
    this.#painted = ''
    this.#paint()
  }

  /**
   * Scroll so `line` is centred, as a user would — which detaches following, here and not on the scroll's own
   * event: that comes a frame later, and a tree drawn before it, still following, put the view straight back on
   * the redex — the keyboard's trap, met by a term map pick and by a pin's first scroll.
   */
  reveal(line: number): void {
    this.#follow.detach()
    this.el.scrollTop = Math.max(0, line * LINE_HEIGHT - this.el.clientHeight / 2)
    this.#paint()
  }

  /** Show `lines` of `tree`. `stale` says the tree belongs to a step other than the one on display. */
  showTree(tree: Tree, lines: readonly Line[], outline: boolean, linked: readonly number[], stale: boolean): void {
    const same =
      tree === this.#tree && lines === this.#lines && outline === this.#outline && sameList(linked, this.#linked)
    this.#flat.hidden = true
    this.#spacer.hidden = false
    if (!same) {
      this.#flat.replaceChildren()
      this.#tree = tree
      this.#lines = lines
      this.#linked = linked
      this.#outline = outline
      this.#active = Math.min(this.#active, Math.max(0, lines.length - 1))
      this.#painted = ''
    }
    this.el.setAttribute('role', 'tree')
    this.el.dataset.layout = outline ? 'outline' : 'code'
    this.el.dataset.step = String(tree.wire.step)
    if (stale) {
      this.el.dataset.stale = 'true'
      this.el.setAttribute('aria-busy', 'true')
    } else {
      delete this.el.dataset.stale
      this.el.removeAttribute('aria-busy')
    }
    this.#paint()
  }

  /** Show a frame's recorded text — before a step's tree arrives, or with `note` when it was refused. */
  showText(frame: LambdaState | null, note: string | null): void {
    this.showFlat(flatText(frame, note))
  }

  /** Show `nodes` as flat text in place of any tree. */
  showFlat(nodes: readonly Node[]): void {
    const mine = this.el.scrollTop
    this.#tree = null
    this.#lines = []
    this.#painted = ''
    this.#rows.replaceChildren()
    this.#spacer.style.height = '0px'
    this.#spacer.hidden = true
    this.#flat.hidden = false
    this.el.setAttribute('role', 'region')
    this.el.dataset.layout = 'flat'
    this.el.removeAttribute('aria-activedescendant')
    delete this.el.dataset.step
    delete this.el.dataset.stale
    this.el.removeAttribute('aria-busy')
    this.#flat.replaceChildren(...nodes)
    this.#tell()
    // THE SPACER GOES, THE BROWSER CLAMPS `scrollTop` AND REPORTS THE CLAMP AS A SCROLL — `#paint`'s trap,
    // met on the way out of a tree. Unrecorded, every flat interlude (a recompile, a refused step, a rebind to
    // a session with no tree yet) read as the user scrolling away, and the next tree was not followed.
    // Recorded rather than ignoring every scroll while no tree is shown, so a user who scrolls a long flat
    // text still takes control as they would of a tree. Reading `scrollTop` forces the layout that clamps.
    if (this.el.scrollTop !== mine) this.#follow.onProgrammaticScroll(this.el.scrollTop)
  }

  #rowId(i: number): string {
    return `term-${this.#id}-row-${i}`
  }

  #marks(tree: Tree, node: number): Mark[] {
    const out: Mark[] = []
    const r = tree.wire.nextRedex
    if (r !== null && tree.contains(r, node)) out.push('is-next-redex')
    const c = tree.wire.contractum
    if (c !== null && tree.contains(c, node)) out.push('is-contractum')
    if (this.#linked.some((l) => tree.contains(l, node))) out.push('is-linked')
    return out
  }

  /**
   * Tell the view whether a re-attach has anything to do. Every change to that ends in a paint — a user's
   * scroll, `attach`, a key that scrolls, a tree shown — or in a flat render, where there is no tree to
   * follow; the TM view's `#drawTable` keeps its own action from the one place its changes reach, the same way.
   */
  #tell(): void {
    const detached = this.#tree !== null && !this.#follow.following
    if (detached === this.#told) return
    this.#told = detached
    this.onDetached?.(detached)
  }

  #paint(): void {
    this.#tell()
    const tree = this.#tree
    if (tree === null) return
    const total = this.#lines.length * LINE_HEIGHT
    this.#spacer.style.height = `${total}px`
    // READ AFTER THE RESIZE: `.term`'s height follows its content up to its cap.
    const viewport = this.el.clientHeight
    const redex = tree.wire.nextRedex
    if (redex !== null) {
      const at = lineOf(tree, this.#lines, redex)
      const top = at < 0 ? null : this.#follow.targetScrollTop(at, LINE_HEIGHT, viewport, total)
      if (top !== null && top !== this.el.scrollTop) {
        this.#follow.onProgrammaticScroll(top)
        this.el.scrollTop = top
      }
    }
    // THE ACTIVE ROW COMES WITH THE VIEW, so `aria-activedescendant` always names a drawn row. Following, or
    // a user's scroll, can carry the view off it — on a tall term the first draw does — and a row outside the
    // drawn window is not in the DOM to be named. Kept to whole rows on screen, not the overscan.
    if (viewport > 0) {
      const top = Math.ceil(this.el.scrollTop / LINE_HEIGHT)
      const bottom = Math.max(top, Math.floor((this.el.scrollTop + viewport) / LINE_HEIGHT) - 1)
      this.#active = Math.min(Math.max(this.#active, top), bottom, this.#lines.length - 1)
    }
    const w = visibleWindow(this.#lines.length, LINE_HEIGHT, viewport, this.el.scrollTop, OVERSCAN)
    const key = `${w.firstIndex}:${w.lastIndex}:${this.#active}`
    if (key === this.#painted) return
    this.#painted = key
    const mine = this.el.scrollTop
    this.#rows.style.transform = `translateY(${w.offsetY}px)`
    const rows: HTMLElement[] = []
    for (let i = w.firstIndex; i <= w.lastIndex; i += 1) rows.push(this.#row(tree, i))
    this.#rows.replaceChildren(...rows)
    // A SHRINKING TERM CLAMPS `scrollTop` ONLY ONCE ITS OLD ROWS ARE GONE — they sit absolutely positioned
    // far down and hold the scroll height up until this replacement — AND THE BROWSER REPORTS THE CLAMP AS A
    // SCROLL. Unrecorded, `Follow` reads it as the user scrolling away and stops following: found in the
    // prototype when a run's last step, a one-line chip, detached the view, and stepping back then left the
    // redex below the drawn window. Reading `scrollTop` here forces the layout that applies the clamp.
    if (this.el.scrollTop !== mine) this.#follow.onProgrammaticScroll(this.el.scrollTop)
    if (this.#active >= w.firstIndex && this.#active <= w.lastIndex) {
      this.el.setAttribute('aria-activedescendant', this.#rowId(this.#active))
    } else {
      this.el.removeAttribute('aria-activedescendant')
    }
  }

  #row(tree: Tree, i: number): HTMLElement {
    const line = this.#lines[i] as Line
    const el = document.createElement('div')
    el.className = i === this.#active ? 'term-line is-active' : 'term-line'
    el.id = this.#rowId(i)
    el.dataset.line = String(i)
    el.setAttribute('role', 'treeitem')
    el.setAttribute('aria-setsize', String(this.#lines.length))
    el.setAttribute('aria-posinset', String(i + 1))
    el.setAttribute('aria-level', String(line.level))
    const gutter = document.createElement('span')
    gutter.className = 'term-gutter'
    gutter.setAttribute('aria-hidden', 'true')
    // THE GLYPH IS CSS (`.term-gutter[data-open]::before`), NOT TEXT, and so is the indentation — a
    // reader of `.term`'s text reads the term, not the chrome drawn around it.
    const d = disclosure(tree, line)
    if (d !== null) {
      gutter.dataset.open = String(d.open)
      gutter.dataset.node = String(d.node)
      // A GLYPH-ONLY CONTROL SAYS WHAT IT WILL DO IN ITS TOOLTIP (the umbrella's rule 1). It has no accessible
      // name to agree with: it is hidden from assistive tech, where the row's `aria-expanded` and ←/→ do its job.
      gutter.title = d.open ? 'fold' : 'open'
      el.setAttribute('aria-expanded', String(d.open))
    }
    el.style.paddingInlineStart = `calc(2ch + ${line.indent}ch)`
    el.append(gutter)
    let before: Mark[] = []
    for (const tok of line.tokens) {
      const marks = this.#marks(tree, tok.node)
      const starting = marks.filter((m) => !before.includes(m)).map((m) => MARKS[m])
      before = marks
      const span = document.createElement('span')
      span.className = [tokenClass(tok), ...marks].join(' ')
      span.dataset.node = String(tok.node)
      if (starting.length > 0) span.dataset.marks = `${starting.join(' ')} `
      span.textContent = tok.text
      el.append(span)
    }
    return el
  }

  #click(e: MouseEvent): void {
    const target = e.target
    if (!(target instanceof HTMLElement)) return
    const row = target.closest<HTMLElement>('.term-line')
    if (row !== null) this.#active = Number(row.dataset.line)
    const node = Number.parseInt(target.dataset.node ?? '', 10)
    if (!Number.isNaN(node)) {
      const opens = ['term-gutter', 'term-chip', 'term-fold'].some((c) => target.classList.contains(c))
      if (opens) this.#on.toggle(node)
      else this.#on.link(node)
    }
    // THE CLICKED ROW IS PAINTED ACTIVE HERE, not left to the redraw the event brings: a click that links
    // nothing brings none. A no-op when that redraw already painted it — the paint is keyed by the active row.
    this.#paint()
  }

  #key(e: KeyboardEvent): void {
    const tree = this.#tree
    if (tree === null || this.#lines.length === 0) return
    const line = this.#lines[this.#active]
    const page = Math.max(1, Math.floor(this.el.clientHeight / LINE_HEIGHT) - 1)
    let next = this.#active
    switch (e.key) {
      case 'ArrowDown':
        next += 1
        break
      case 'ArrowUp':
        next -= 1
        break
      case 'PageDown':
        next += page
        break
      case 'PageUp':
        next -= page
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = this.#lines.length - 1
        break
      case 'ArrowLeft': {
        // ← FOLDS THE INNERMOST OPEN THING ON THE ROW FIRST, undoing → in reverse: an open chip, then the head
        // the application took the row from, then the row's own node. On a row the layout gives no node, the
        // chip is also the row's disclosure. On the first ← of a broken head the row's `aria-expanded`, which is
        // the application's, does not change: a screen-reader user hears the head's rows go, not the row collapse.
        if (line === undefined) return
        const d = disclosure(tree, line)
        const head = line.inner
        const headOpen = head !== undefined && !line.tokens.some((t) => t.node === head && t.kind === 'fold')
        const node =
          chipsOn(tree, line).find((c) => c.open)?.node ??
          (headOpen ? head : undefined) ??
          (d?.open ? d.node : undefined)
        if (node === undefined) return
        e.preventDefault()
        this.#on.toggle(node)
        return
      }
      case 'ArrowRight': {
        // → OPENS WHAT IS CLOSED ON THE ROW: the node it discloses when that is folded, and otherwise the
        // first fold or chip inside it — which is how the keyboard reaches a folded head on its application's row.
        const closed = firstClosed(line)
        if (closed === undefined) return
        e.preventDefault()
        this.#on.toggle(closed.node)
        return
      }
      case 'Enter': {
        const first = line?.tokens[0]
        if (first === undefined) return
        e.preventDefault()
        // ENTER OPENS WHAT → OPENS — "a chip opens on click or Enter, like any fold" (spec §5.2) — and links
        // from a row with nothing closed on it. It opened only a chip, so a folded row linked instead.
        const closed = firstClosed(line)
        if (closed !== undefined) this.#on.toggle(closed.node)
        else this.#on.link(first.node)
        return
      }
      default:
        return
    }
    e.preventDefault()
    this.#active = Math.min(Math.max(next, 0), this.#lines.length - 1)
    const top = this.#active * LINE_HEIGHT
    const to = top < this.el.scrollTop ? top : Math.max(this.el.scrollTop, top + LINE_HEIGHT - this.el.clientHeight)
    // A KEY THAT SCROLLS IS THE USER TAKING CONTROL, and `Follow` must hear so before the paint below: its
    // `scroll` event comes a frame later, and a paint still following put the view back on the redex.
    if (to !== this.el.scrollTop) {
      this.#follow.detach()
      this.el.scrollTop = to
    }
    this.#painted = ''
    this.#paint()
  }
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}
