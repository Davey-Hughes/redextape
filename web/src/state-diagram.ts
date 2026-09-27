import { type Local, localLevel, predecessors, REACH } from './local-level'
import { type Arc, arcsOf, chipsOf, type Edges, type ProgramRow, programRows } from './program-level'
import { type Groups, groupStates, stepOf, type Tier } from './state-groups'
import { Follow, ROW_HEIGHT } from './state-table'
import type { TmProgram, TmState } from './types'
import { visibleWindow } from './virtual-list'

/** Rows drawn beyond the viewport on each side — the rule table's `OVERSCAN`, for its reason. */
const OVERSCAN = 4
/** Pixels between two lanes of *arcs*' gutter, and the gutter's margin beside the rows. */
const LANE = 9
const GUTTER_PAD = 12
/** The runtime column's boxes: each one row tall, a row apart, and this wide. Must match `.program-box`'s `width`. */
const BOX_WIDTH = 104
/**
 * The local level's grid: a column per signed distance, at least `COLUMN_MIN` wide, its node `GAP` narrower so the
 * edges between columns have room for their labels, and each node `NODE_STEP` below the last. `TOP` leaves room above
 * the first row for a self-loop and its label.
 */
const COLUMN_MIN = 150
const GAP = 64
const NODE_STEP = 44
const NODE_HEIGHT = 24
const PAD = 8
const TOP = 30
const SVG = 'http://www.w3.org/2000/svg'

let minted = 0

export type DiagramEvents = {
  /** Link `state`'s construct, as a click on its row of the rule table does (spec §8). */
  readonly link: (state: number) => void
  /** The view scrolled or its following changed: the pane redraws the header action that re-attaches it. */
  readonly moved?: () => void
  /** The current instruction's "show states" (spec §8): switch to the local level. */
  readonly showStates?: () => void
}

/** Which level the diagram shows: spec §8's *program | local*. */
export type Level = 'program' | 'local'

/**
 * The state diagram (Plan 7 part 4, spec §8), at either of its two levels.
 *
 * THE PROGRAM LEVEL is one row per instruction, or per name group, with its state count and a ⚠ where it reaches
 * `overflow`; the current row open onto its sub-steps; and the edges between rows drawn as *arcs* — a gutter of
 * lanes, the runtime routines in a column of their own — or as *chips*, text on each row (amendment 11).
 *
 * THE LOCAL LEVEL is the current state and every state within `REACH` rules of it, in columns by signed distance
 * (amendment 10), the rules between them drawn and labelled with the tapes they touch. A machine with no program
 * level — neither instructions nor dotted names (§7's third tier) — shows it alone.
 *
 * **WHAT IS BUILT WHEN** (amendment 18). The groups, the arcs and their lanes are built once per machine
 * (`setProgram`), and the list of rows once per current group, since the current group is the one that opens onto
 * its sub-steps (`#layout`). Every draw — each frame, scroll and resize, and the view's draw when it takes the
 * focus — builds the window's row elements, the gutter's paths and the runtime column's connectors afresh, as the
 * rule table builds its rows (`#draw`). The local level is laid out only when the current state or its width
 * changes, and its marks are repainted in place.
 *
 * **THE ROWS VIRTUALIZE AS THE RULE TABLE'S DO**, at `ROW_HEIGHT` each and through the same `visibleWindow`:
 * `list150` compiles to 302 instructions (spec §14.1). An arc whose ends are both off the window but whose span
 * crosses it is still drawn, clipped by the gutter's own box.
 *
 * **A GRID, AS THE RULE TABLE IS** (spec §9.2): one tab stop, one `gridcell` per row, and a roving active row by
 * index that `aria-activedescendant` names. In *arcs* each row keeps its chips' text, visually hidden: it is what
 * the arcs say to a screen reader. *Arcs*' runtime column is the program level's second tab stop, its boxes a roving
 * group, since the routines have no rows there.
 */
export class StateDiagram {
  /** The panel's body: the program level's scrolling grid, and in *arcs* the runtime column beside it. */
  readonly el: HTMLElement
  #on: DiagramEvents
  #id = `diagram-${minted++}`
  #scroll: HTMLElement
  #spacer: HTMLElement
  #rowsEl: HTMLElement
  #gutter: SVGSVGElement
  #side: HTMLElement
  #sideLinks: SVGSVGElement
  #boxes: HTMLElement
  #programEl: HTMLElement
  #localEl: HTMLElement
  #localEdges: SVGSVGElement
  #localNodes: HTMLElement

  #program: TmProgram | null = null
  #groups: Groups | null = null
  #arcs: Arc[] = []
  #lanes = 0
  #edges: Edges = 'arcs'
  #level: Level = 'program'
  /** The tapes' names, for the local level's edge labels. */
  #names: readonly string[] = []
  /** Each state's predecessors, once per machine: the local level looks behind as well as ahead. */
  #into: number[][] = []
  #local: Local = { nodes: [], edges: [] }
  /** The state the local level was laid out around, or `null` when it has not been. */
  #localAround: number | null = null
  /** The local level's roving cursor: the state whose node holds the one tab stop. */
  #localActive: number | null = null
  /** The width the local level was last laid out for. */
  #localWidth = 0
  #linkedStates: Set<number> = new Set()
  #frame: TmState | null = null
  /** The current group, or `null` with no frame, and for the `overflow` state, which is a badge. */
  #current: number | null = null
  #rows: ProgramRow[] = []
  /** `#rowOf[group]` is the group's row in `#rows`, or `-1` when it has none (a runtime routine in *arcs*). */
  #rowOf: Int32Array = new Int32Array(0)
  #linked: Set<number> = new Set()
  #follow = new Follow()
  /** The scroll box's height at the last draw — how its `scroll` handler tells a clamp from a user's scroll. */
  #drawnHeight = 0
  #active = 0
  /** The runtime column's roving tab stop: the group whose box holds it, or `null` for the first box. */
  #activeBox: number | null = null

  constructor(on: DiagramEvents) {
    this.#on = on
    this.el = document.createElement('div')
    this.el.className = 'state-diagram'
    const program = document.createElement('div')
    program.className = 'program-level'

    this.#scroll = document.createElement('div')
    this.#scroll.className = 'program-scroll'
    this.#scroll.setAttribute('role', 'grid')
    this.#scroll.setAttribute('aria-label', 'program')
    this.#scroll.tabIndex = 0
    this.#spacer = document.createElement('div')
    this.#spacer.className = 'program-spacer'
    this.#spacer.setAttribute('role', 'none')
    this.#gutter = document.createElementNS(SVG, 'svg')
    this.#gutter.classList.add('program-gutter')
    this.#gutter.setAttribute('aria-hidden', 'true')
    this.#rowsEl = document.createElement('div')
    this.#rowsEl.className = 'program-rows'
    this.#rowsEl.setAttribute('role', 'rowgroup')
    this.#spacer.append(this.#gutter, this.#rowsEl)
    this.#scroll.append(this.#spacer)

    // THE RUNTIME COLUMN (*arcs* only): the routines billed to no instruction, and their connectors, which
    // are drawn against the view's own top rather than the list's, so they meet the rows where they are on
    // screen. Its boxes are buttons — the rows cannot hold them, since *arcs* gives the routines no rows.
    this.#side = document.createElement('div')
    this.#side.className = 'program-side'
    this.#sideLinks = document.createElementNS(SVG, 'svg')
    this.#sideLinks.classList.add('program-links')
    this.#sideLinks.setAttribute('aria-hidden', 'true')
    this.#boxes = document.createElement('div')
    this.#boxes.className = 'program-boxes'
    this.#boxes.setAttribute('role', 'group')
    this.#boxes.setAttribute('aria-label', 'runtime')
    this.#side.append(this.#sideLinks, this.#boxes)

    program.append(this.#scroll, this.#side)
    this.#programEl = program

    // THE LOCAL LEVEL: nodes are buttons in one group, with a roving `tabindex`, so the level is one tab stop (spec
    // §8) and arrows move between states; its edges are SVG under them.
    this.#localEl = document.createElement('div')
    this.#localEl.className = 'local-level'
    this.#localEl.hidden = true
    this.#localEdges = document.createElementNS(SVG, 'svg')
    this.#localEdges.classList.add('local-edges')
    this.#localEdges.setAttribute('aria-hidden', 'true')
    this.#localNodes = document.createElement('div')
    this.#localNodes.className = 'local-nodes'
    this.#localNodes.setAttribute('role', 'group')
    this.#localNodes.setAttribute('aria-label', `states within ${REACH} rules`)
    // A FALLBACK FOCUS TARGET: not in the tab order itself, but focusable programmatically, for
    // `#focusShown` to land on when the level empties out from under whichever node held the roving
    // tab stop — there is otherwise nothing left in the local level to receive it.
    this.#localNodes.tabIndex = -1
    this.#localEl.append(this.#localEdges, this.#localNodes)
    this.#localNodes.addEventListener('click', (e) => {
      const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.local-node') : null
      if (el === null) return
      this.#localActive = Number(el.dataset.state)
      // PAINTED BEFORE LINKING, as the program level's row click and the rule table's row click both are: `link`
      // can return early for a pane that is nothing else's to link, and the clicked node should hold the tab
      // stop regardless — not stay at `tabIndex -1` because the paint that would have moved it never ran.
      this.#paintLocal()
      this.#on.link(Number(el.dataset.state))
    })
    this.#localNodes.addEventListener('keydown', (e) => this.#localKey(e))
    // THE LOCAL LEVEL IS LAID OUT FOR A WIDTH, so a width it was not laid out for lays it out again — a divider
    // drag, a window resize. The panel's own reopening goes through its `onToggle`'s `redraw()` instead of this.
    new ResizeObserver(() => {
      if (this.#localEl.clientWidth === this.#localWidth) return
      this.#localAround = null
      if (this.shown === 'local') this.#drawLocal()
    }).observe(this.#localEl)
    this.el.append(program, this.#localEl)

    this.#scroll.addEventListener('scroll', () => {
      if (this.#scroll.clientHeight === 0) return
      // A BOX THAT CHANGED HEIGHT SINCE IT WAS DRAWN MAY HAVE HAD ITS SCROLL CLAMPED, and this event can come before
      // the resize observer's: a panel beside it that closed read the layout at once, in its own toggle.
      if (this.#scroll.clientHeight !== this.#drawnHeight) this.#follow.onResize(this.#scroll.scrollTop)
      this.#follow.onScroll(this.#scroll.scrollTop)
      this.#draw()
      this.#on.moved?.()
    })
    // NOTHING IN THE ROWS TAKES THE FOCUS ON `mousedown`; THE GRID TAKES IT WHEN THE CLICK LANDS — the rule table's
    // rows container says why (`TmPane`'s constructor): the view's draw on taking the focus replaced the row under
    // the pointer, and the click was lost. *Show states* lost every click, since a button out of the tab order still
    // takes the focus from a pointer. The primary button only, so a middle button still scrolls.
    this.#rowsEl.addEventListener('mousedown', (e) => {
      if (e.button === 0) e.preventDefault()
    })
    this.#rowsEl.addEventListener('click', (e) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      const show = target !== null && target.closest('.program-show') !== null
      const el = target === null ? null : target.closest<HTMLElement>('.program-row')
      // THE FOCUS FIRST, as `mousedown` would have moved it, so *show states*' hand-off (`setLevel`) finds it in
      // this level and moves it to the next — never leaving it on the page.
      this.#scroll.focus({ preventScroll: true })
      if (show) {
        this.#on.showStates?.()
        return
      }
      if (el === null) return
      const i = Number(el.dataset.row)
      this.#active = i
      this.#draw()
      // A CLICK LINKS A GROUP'S ROW AND DOES NOTHING ELSE: a click on a sub-step, or on a label, is only a click on
      // a row. *Show states* is its button's, or Enter's on its row (`#linkRow`).
      if (this.#rows[i]?.kind === 'group') this.#linkRow(i)
    })
    this.#boxes.addEventListener('click', (e) => {
      const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.program-box') : null
      if (el === null) return
      this.#activeBox = Number(el.dataset.group)
      this.#paintBoxes()
      const first = this.#groups?.groups[Number(el.dataset.group)]?.first
      if (first !== undefined && first >= 0) this.#on.link(first)
    })
    this.#boxes.addEventListener('keydown', (e) => this.#boxKey(e))
    this.#scroll.addEventListener('keydown', (e) => this.#key(e))
    new ResizeObserver(() => {
      this.#follow.onResize(this.#scroll.scrollTop)
      this.#draw()
    }).observe(this.#scroll)
  }

  /**
   * Whether the program level follows the running state; a user scroll or a key that scrolls detaches it. The local
   * level always follows — it is drawn around the current state — so it says so.
   */
  get following(): boolean {
    return this.shown === 'local' || this.#follow.following
  }

  /** How this machine groups (§7), or `none` with no machine. */
  get tier(): Tier {
    return this.#groups?.tier ?? 'none'
  }

  /**
   * The level on screen: the one chosen, unless the machine itself HAS NO PROGRAM LEVEL TO SHOW AT ALL
   * (§7's third tier — its states carry neither an instruction nor a dotted name to group by).
   * **NO MACHINE AT ALL IS NOT THAT TIER** — `tier` reads `'none'` for both, but only a real machine can
   * lack a program level; a compile that produced nothing shows whichever level was already stored,
   * empty, rather than being forced to `local` out from under a reader who chose `program`.
   */
  get shown(): Level {
    return this.#level === 'local' || (this.#groups !== null && this.tier === 'none') ? 'local' : 'program'
  }

  /** Group a new machine's states. Once per compile, like the rule table's `StateIndex`. */
  setProgram(p: TmProgram | null, names: readonly string[] = []): void {
    // THE FOCUS GOES WITH THE LEVEL ON A RECOMPILE TOO (`setLevel`'s reason): a machine with a program level
    // compiled into one with none, or back, hides the level that held it; and the runtime column's boxes are built
    // again below, so one holding it is gone. Either way it moves to the shown level's tab stop.
    const had = this.el.contains(document.activeElement)
    const was = this.shown
    this.#program = p
    this.#names = names
    this.#into = p === null ? [] : predecessors(p)
    this.#localAround = null
    this.#localActive = null
    this.#linkedStates = new Set()
    this.#groups = p === null ? null : groupStates(p)
    this.#arcs = this.#groups === null ? [] : arcsOf(this.#groups)
    this.#lanes = this.#arcs.reduce((n, a) => Math.max(n, a.lane + 1), 0)
    this.#linked = new Set()
    this.#current = null
    this.#frame = null
    this.#active = 0
    this.#activeBox = null
    this.#follow.attach()
    this.#follow.onProgrammaticScroll(0)
    this.#scroll.scrollTop = 0
    this.#drawBoxes()
    this.#layout()
    if (had && (this.shown !== was || !this.el.contains(document.activeElement))) this.#focusShown()
  }

  /** Show *arcs* or *chips*: the rows and the column change, the groups and the arcs do not. */
  setEdges(edges: Edges): void {
    if (edges === this.#edges) return
    this.#edges = edges
    this.#drawBoxes()
    this.#layout()
  }

  /**
   * Show the program level or the local one. `render` and `setLinked` keep `#current` and `#linked` current
   * regardless of which level is shown; `#groups` itself only changes in `setProgram`. So switching back to
   * program needs no rebuild of any of those — just `#layout()`'s own redraw of whichever level is now shown.
   */
  setLevel(level: Level): void {
    if (level === this.#level) return
    // THE FOCUS GOES WITH THE LEVEL. The level it was in is hidden now, and a hidden element's focus falls to the
    // page: *show states* in the grid moved it to `<body>`. It moves to the shown level's own tab stop.
    const had = this.el.contains(document.activeElement)
    this.#level = level
    this.#layout()
    if (had) this.#focusShown()
  }

  /** The machine's frame: which group is current, and which sub-step — and, at the local level, which state. */
  render(frame: TmState | null): void {
    this.#frame = frame
    const g = frame === null ? null : (this.#groups?.groupOf[frame.state] ?? -1)
    const current = g === null || g < 0 ? null : g
    if (current !== this.#current) {
      this.#current = current
      this.#layout()
    } else {
      this.#draw()
      if (this.shown === 'local') this.#drawLocal()
    }
  }

  /** Mark the groups holding any of `states` — a link's block, which the rule table marks too. */
  setLinked(states: readonly number[]): void {
    const groups = this.#groups
    this.#linkedStates = new Set(states)
    this.#paintLocal()
    this.#linked = new Set()
    if (groups !== null) {
      for (const s of states) {
        const g = groups.groupOf[s] ?? -1
        if (g >= 0) this.#linked.add(g)
      }
    }
    this.#draw()
  }

  /** Follow the running state again, and scroll to it now. */
  attach(): void {
    this.#follow.attach()
    this.#draw()
  }

  /** Redraw after the panel opens, or after anything else that changed its size without a scroll or a frame. */
  redraw(): void {
    this.#draw()
    if (this.shown === 'local') this.#drawLocal()
  }

  /**
   * Focus the shown level's tab stop: the grid, or the local level's active node — or, with no node at
   * all (the level just emptied), the local level's own container, its fallback (`#localNodes`'
   * constructor comment).
   */
  #focusShown(): void {
    if (this.shown === 'program') this.#scroll.focus()
    else (this.#localNodes.querySelector<HTMLElement>('.local-node[tabindex="0"]') ?? this.#localNodes).focus()
  }

  /** Rebuild the rows — a new machine, a new current group, or the other rendering — and draw them. */
  #layout(): void {
    const groups = this.#groups
    // THE ACTIVE ROW IS A ROW, NOT A PLACE: the sub-steps row moves with the current group and shifts every row
    // between its old place and its new one, so the active row is found again by what it is.
    const was = this.#rows[this.#active]
    this.#rows = groups === null ? [] : programRows(groups, this.#program?.labels ?? [], this.#edges, this.#current)
    if (was !== undefined) {
      const again = this.#rows.findIndex((r) => sameRow(r, was))
      if (again >= 0) this.#active = again
    }
    this.#rowOf = new Int32Array(groups?.groups.length ?? 0).fill(-1)
    for (const [i, row] of this.#rows.entries()) if (row.kind === 'group') this.#rowOf[row.group] = i
    this.#scroll.setAttribute('aria-rowcount', String(this.#rows.length))
    this.el.dataset.edges = this.#edges
    this.el.dataset.level = this.shown
    this.#programEl.hidden = this.shown !== 'program'
    this.#localEl.hidden = this.shown !== 'local'
    this.#draw()
    if (this.shown === 'local') this.#drawLocal()
  }

  /**
   * The runtime column's boxes, one per routine, in *arcs* only — built when the machine or the rendering changes,
   * never per frame, so a box holding the focus keeps it while the run moves; their marks are `#paintBoxes`'.
   */
  #drawBoxes(): void {
    const groups = this.#groups
    const runtime = this.#edges === 'arcs' && groups !== null ? groups.groups.filter((g) => g.runtime) : []
    this.#side.hidden = runtime.length === 0
    this.#boxes.replaceChildren(
      ...runtime.map((g, k) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'program-box'
        b.dataset.group = String(groups?.groups.indexOf(g) ?? -1)
        b.style.top = `${k * ROW_HEIGHT}px`
        const name = document.createElement('span')
        name.textContent = g.name
        const count = document.createElement('span')
        count.className = 'program-count'
        count.textContent = String(g.count)
        b.append(name, count)
        if (g.overflow) b.append(warning())
        return b
      }),
    )
    this.#paintBoxes()
  }

  /**
   * The boxes' marks — the current routine, the linked ones — and their roving tab stop: the column is one tab stop,
   * as the grid is, with ↑/↓ between its boxes (`#boxKey`).
   */
  #paintBoxes(): void {
    const boxes = [...this.#boxes.children].filter((b): b is HTMLElement => b instanceof HTMLElement)
    const stop = boxes.some((b) => Number(b.dataset.group) === this.#activeBox)
      ? this.#activeBox
      : Number(boxes[0]?.dataset.group)
    for (const box of boxes) {
      const g = Number(box.dataset.group)
      box.classList.toggle('is-current', g === this.#current)
      if (g === this.#current) box.setAttribute('aria-current', 'step')
      else box.removeAttribute('aria-current')
      box.classList.toggle('is-linked', this.#linked.has(g))
      box.tabIndex = g === stop ? 0 : -1
    }
  }

  /** ↑/↓ move the runtime column's tab stop between its boxes, and the focus with it; Enter is a button's own. */
  #boxKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const boxes = [...this.#boxes.querySelectorAll<HTMLElement>('.program-box')]
    const at = boxes.indexOf(document.activeElement as HTMLElement)
    const next = boxes[at + (e.key === 'ArrowDown' ? 1 : -1)]
    e.preventDefault()
    if (next === undefined) return
    this.#activeBox = Number(next.dataset.group)
    this.#paintBoxes()
    next.focus()
  }

  /**
   * Draw the rows in view, the arcs across them, and the runtime column's connectors, each as new elements. On
   * every frame, scroll and resize, and every draw of the view — O(visible rows + arcs + edges), not merely the
   * visible rows, since `#drawArcs` below walks every arc and `#drawLinks` every group's targets on each call.
   */
  #draw(): void {
    const groups = this.#groups
    const viewport = this.#scroll.clientHeight
    this.#drawnHeight = viewport
    const total = this.#rows.length * ROW_HEIGHT
    // A LISTING THAT JUST LOST A ROW CLAMPS `scrollTop` ONCE THE SPACER SHRINKS TO MATCH IT — a runtime
    // routine has no row in *arcs*, so the current group's sub-steps row disappears the moment the run
    // steps into one, and the listing shrinks under a scroll position it no longer reaches (measured:
    // 626 → 600 px, `pc20` into `halt`). The clamp itself is not visible in `scrollTop` yet here — the
    // gutter SVG below still holds its OLD, taller height until `#drawArcs` resizes it a few lines on, so
    // the guard further down, which reads `scrollTop` before that resize, does not see it either. `total`
    // above is already the listing's real, post-shrink height, so the clamp this draw is about to cause
    // is recorded before anything actually shrinks, rather than read back afterwards. The predicted
    // position can land a couple of pixels short of the browser's own, when a bordered last row overflows
    // the spacer — still comfortably inside `ECHO_TOLERANCE`.
    const clampedTop = Math.max(0, total - viewport)
    if (this.#scroll.scrollTop > clampedTop) this.#follow.onProgrammaticScroll(clampedTop)
    this.#spacer.style.height = `${total}px`
    if (groups === null || viewport === 0) {
      if (groups === null) {
        this.#rowsEl.replaceChildren()
        this.#scroll.removeAttribute('aria-activedescendant')
        // NO MACHINE, NO ARCS: `#drawArcs` never runs for a `null` compile, so the gutter otherwise keeps
        // the LAST machine's paths and size, extending the scrollable region past the now-emptied spacer —
        // a scroll range with nothing in it. Removing `width`/`height` is not enough: an `<svg>` with
        // neither falls back to its own 300×150 box, which still reaches past the diagram once the window
        // was scrolled before the machine emptied — setting both to `'0'` is what actually empties it.
        // Its `top`, left at the old window's offset, needs no reset alongside them: checked against a
        // scrolled window, a zero-sized box adds nothing to the scrollable region at any offset. The side
        // column's connectors are the same leftover, one step removed: `#drawBoxes` already clears its
        // boxes and hides the column on every `setProgram`, but `#drawLinks`, which draws these, only runs
        // on this same non-null path, so they are cleared here too.
        this.#gutter.replaceChildren()
        this.#gutter.setAttribute('width', '0')
        this.#gutter.setAttribute('height', '0')
        this.#sideLinks.replaceChildren()
      }
      return
    }
    const current = this.#current === null ? -1 : (this.#rowOf[this.#current] ?? -1)
    if (current >= 0) {
      const top = this.#follow.targetScrollTop(current, ROW_HEIGHT, viewport, total)
      if (top !== null && top !== this.#scroll.scrollTop) {
        this.#follow.onProgrammaticScroll(top)
        this.#scroll.scrollTop = top
      }
    }
    // THE ACTIVE ROW COMES WITH THE VIEW, as the rule table's does: `aria-activedescendant` names a drawn row.
    const topRow = Math.ceil(this.#scroll.scrollTop / ROW_HEIGHT)
    const bottomRow = Math.max(topRow, Math.floor((this.#scroll.scrollTop + viewport) / ROW_HEIGHT) - 1)
    this.#active = Math.max(0, Math.min(Math.max(this.#active, topRow), bottomRow, this.#rows.length - 1))

    const w = visibleWindow(this.#rows.length, ROW_HEIGHT, viewport, this.#scroll.scrollTop, OVERSCAN)
    const gutter = this.#edges === 'arcs' && this.#lanes > 0 ? this.#lanes * LANE + GUTTER_PAD : 0
    this.#rowsEl.style.transform = `translateY(${w.offsetY}px)`
    this.#rowsEl.style.left = `${gutter}px`
    const els: HTMLElement[] = []
    for (let i = w.firstIndex; i <= w.lastIndex; i += 1) els.push(this.#row(i, groups))
    const mine = this.#scroll.scrollTop
    this.#rowsEl.replaceChildren(...els)
    // THIS ONLY SEES A CHANGE `replaceChildren` ITSELF MAKES: `mine`, just above, is read after the spacer
    // write and the follow-target and active-row work earlier in this method, so a clamp from any of
    // those is already the prediction above's to have recorded. When swapping the drawn rows moves
    // `scrollTop` on its own, this records that too, so it still reads as the echo it is.
    if (this.#scroll.scrollTop !== mine) this.#follow.onProgrammaticScroll(this.#scroll.scrollTop)
    if (this.#active >= w.firstIndex && this.#active <= w.lastIndex) {
      this.#scroll.setAttribute('aria-activedescendant', `${this.#id}-${this.#active}`)
    } else {
      this.#scroll.removeAttribute('aria-activedescendant')
    }
    this.#drawArcs(w.firstIndex, w.lastIndex, w.offsetY, gutter)
    this.#drawLinks(groups)
    // THE RUNTIME COLUMN'S BOXES CARRY THE ROWS' MARKS: in *arcs* a routine has no row, so its box is where the
    // machine is when it is inside one, and where a link into one lands.
    this.#paintBoxes()
  }

  #row(i: number, groups: Groups): HTMLElement {
    const row = this.#rows[i] as ProgramRow
    const el = document.createElement('div')
    el.className = 'program-row'
    el.dataset.row = String(i)
    el.setAttribute('role', 'row')
    el.setAttribute('aria-rowindex', String(i + 1))
    const cell = document.createElement('div')
    cell.id = `${this.#id}-${i}`
    cell.className = 'program-cell'
    cell.setAttribute('role', row.kind === 'label' || row.kind === 'heading' ? 'rowheader' : 'gridcell')
    el.append(cell)
    if (i === this.#active) el.classList.add('is-active')
    switch (row.kind) {
      case 'label':
      case 'heading':
        el.classList.add(row.kind === 'label' ? 'is-label' : 'is-heading')
        cell.textContent = row.kind === 'label' ? `${row.name}:` : row.name
        return el
      case 'steps': {
        el.classList.add('is-steps')
        // "SHOW STATES" (spec §8): the local level, around the state this row's current sub-step is. Out of the tab
        // order, since the grid is the level's one tab stop — Enter on the row does the same — and FIRST, so a
        // gadget with twenty sub-steps cannot push it past the row's clipped end.
        const show = document.createElement('button')
        show.type = 'button'
        show.className = 'program-show'
        show.tabIndex = -1
        show.textContent = 'show states'
        cell.append(show)
        const now = this.#frame === null ? null : stepOf(this.#program?.states[this.#frame.state]?.name ?? '')
        for (const step of groups.groups[row.group]?.steps ?? []) {
          const s = document.createElement('span')
          s.className = step === now ? 'program-step is-now' : 'program-step'
          s.textContent = step
          cell.append(s)
        }
        return el
      }
      case 'group': {
        const g = groups.groups[row.group]
        if (g === undefined) return el
        if (row.group === this.#current) {
          el.classList.add('is-current')
          el.setAttribute('aria-current', 'step')
        }
        if (this.#linked.has(row.group)) el.classList.add('is-linked')
        const name = document.createElement('span')
        name.className = 'program-name'
        name.textContent = g.name
        cell.append(name)
        const line = g.instr === null ? undefined : this.#program?.listing[g.instr]
        if (line !== undefined) {
          const [mnemonic, operands] = line.split('\t')
          const text = document.createElement('span')
          text.className = 'program-text'
          const m = document.createElement('b')
          m.textContent = mnemonic ?? ''
          text.append(m)
          if (operands !== undefined) text.append(` ${operands}`)
          cell.append(text)
        }
        const chips = chipsOf(groups, this.#program?.labels ?? [], row.group)
        const said = [chips.to, chips.from].filter((c) => c !== '')
        if (said.length > 0) {
          const box = document.createElement('span')
          // IN *ARCS* THE CHIPS ARE THE ARCS' WORDS, PRESENT AND UNSEEN (amendment 11).
          box.className = this.#edges === 'chips' ? 'program-chips' : 'program-chips visually-hidden'
          for (const c of said) {
            const chip = document.createElement('span')
            chip.className = 'program-chip'
            chip.textContent = c
            box.append(chip)
          }
          cell.append(box)
        }
        if (g.overflow) cell.append(warning())
        const count = document.createElement('span')
        count.className = 'program-count'
        count.textContent = `${g.count} ${g.count === 1 ? 'state' : 'states'}`
        cell.append(count)
        return el
      }
    }
  }

  /** *Arcs*' gutter: every arc whose span crosses rows `first..last`, in the window's own coordinates. */
  #drawArcs(first: number, last: number, offsetY: number, width: number): void {
    const paths: SVGElement[] = []
    this.#gutter.style.top = `${offsetY}px`
    this.#gutter.setAttribute('width', String(width))
    this.#gutter.setAttribute('height', String((last - first + 1) * ROW_HEIGHT))
    if (width > 0) {
      for (const arc of this.#arcs) {
        const a = this.#rowOf[arc.from] ?? -1
        const b = this.#rowOf[arc.to] ?? -1
        if (a < 0 || b < 0 || Math.max(a, b) < first || Math.min(a, b) > last) continue
        const y = (row: number) => (row - first) * ROW_HEIGHT + ROW_HEIGHT / 2
        const x = width - GUTTER_PAD + 2 - (arc.lane + 1) * LANE
        const hot = arc.from === this.#current || arc.to === this.#current
        paths.push(
          svg('path', {
            d: `M${width} ${y(a)} H${x} V${y(b)} H${width - 3} M${width - 7} ${y(b) - 3} L${width - 3} ${y(b)} L${width - 7} ${y(b) + 3}`,
            class: hot ? 'program-arc is-hot' : 'program-arc',
          }),
        )
      }
    }
    this.#gutter.replaceChildren(...paths)
  }

  /**
   * The runtime column's connectors, against the view's own top: from each drawn row with an edge to or from a
   * routine, across to that routine's box, and between routines on the column's far side.
   */
  #drawLinks(groups: Groups): void {
    if (this.#side.hidden) return
    const height = this.#scroll.clientHeight
    this.#sideLinks.setAttribute('height', String(height))
    const boxOf = new Map<number, number>()
    let k = 0
    for (const [i, g] of groups.groups.entries()) if (g.runtime) boxOf.set(i, k++)
    const boxY = (g: number) => (boxOf.get(g) ?? 0) * ROW_HEIGHT + ROW_HEIGHT / 2
    const rowY = (g: number) => (this.#rowOf[g] ?? 0) * ROW_HEIGHT + ROW_HEIGHT / 2 - this.#scroll.scrollTop
    const left = 16 + boxOf.size * 6
    const paths: SVGElement[] = []
    const edge = (d: string) => paths.push(svg('path', { d, class: 'program-link' }))
    for (const [g, group] of groups.groups.entries()) {
      for (const h of group.targets) {
        const into = boxOf.get(h)
        const from = boxOf.get(g)
        if (from === undefined && into !== undefined) {
          const y = rowY(g)
          if (y < 0 || y > height) continue
          const x = 4 + into * 6
          edge(
            `M0 ${y} H${x} V${boxY(h)} H${left - 3} M${left - 7} ${boxY(h) - 3} L${left - 3} ${boxY(h)} L${left - 7} ${boxY(h) + 3}`,
          )
        } else if (from !== undefined && into === undefined) {
          const y = rowY(h)
          if (y < 0 || y > height) continue
          const x = 4 + from * 6
          edge(`M${left} ${boxY(g)} H${x} V${y} H3 M7 ${y - 3} L3 ${y} L7 ${y + 3}`)
        } else if (from !== undefined && into !== undefined) {
          const right = left + BOX_WIDTH
          const x = right + 6 + from * 5
          edge(`M${right} ${boxY(g)} H${x} V${boxY(h)} H${right + 3}`)
        }
      }
    }
    this.#sideLinks.replaceChildren(...paths)
    this.#boxes.style.left = `${left}px`
  }

  /**
   * Lay the local level out around the current state — only when that state changed, since it is small but not
   * free (spec §8) — and paint its marks.
   */
  #drawLocal(): void {
    const p = this.#program
    const current = this.#frame?.state ?? null
    // NOTHING WHILE IT IS NOT DRAWN — a closed panel, a view off the page: a layout there would be for no width at
    // all, and it is marked stale so the next one on screen lays it out.
    if (this.#localEl.clientWidth === 0) {
      this.#localAround = null
      return
    }
    if (p === null || current === null) {
      // THE FOCUS GOES WITH THE LEVEL HERE TOO (`setLevel`'s own reason): a node holding it is about to be
      // removed, and a removed element's focus falls to the page rather than following it anywhere. With
      // every node gone, `#focusShown`'s local branch falls back to `#localNodes` itself.
      const had = this.#localNodes.contains(document.activeElement)
      this.#localNodes.replaceChildren()
      this.#localEdges.replaceChildren()
      this.#localAround = null
      if (had) this.#focusShown()
      return
    }
    if (current !== this.#localAround) {
      this.#localAround = current
      this.#local = localLevel(p, this.#into, current, this.#frame?.rule ?? null, this.#names)
      if (this.#localActive === null || !this.#local.nodes.some((n) => n.state === this.#localActive)) {
        this.#localActive = current
      }
      this.#layoutLocal(p)
    }
    this.#paintLocal()
  }

  /** Place the nodes in their columns and draw the edges between them. */
  #layoutLocal(p: TmProgram): void {
    // A NODE HOLDING THE FOCUS IS REBUILT BELOW, AND ITS FOCUS WOULD FALL TO THE PAGE: it goes to the active node.
    const had = this.#localNodes.contains(document.activeElement)
    this.#localWidth = this.#localEl.clientWidth
    const width = Math.max(this.#localWidth, (2 * REACH + 1) * COLUMN_MIN)
    const column = Math.floor(width / (2 * REACH + 1))
    const nodeWidth = column - GAP
    const at = new Map<number, { x: number; y: number }>()
    const filled = new Map<number, number>()
    for (const n of this.#local.nodes) {
      const row = filled.get(n.column) ?? 0
      filled.set(n.column, row + 1)
      at.set(n.state, { x: (n.column + REACH) * column + PAD, y: TOP + row * NODE_STEP })
    }
    const height = TOP + PAD + Math.max(1, ...filled.values()) * NODE_STEP
    this.#localNodes.style.height = `${height}px`
    this.#localEdges.setAttribute('width', String(width))
    this.#localEdges.setAttribute('height', String(height))
    // COMPUTED ONCE HERE, FOR THE FIRST PAINT: `#paintLocal`, called right after this returns, repaints it
    // fresh on every later frame — see `#nextEdge`'s own doc for why a layout cannot just bake it in.
    const next = this.#nextEdge()
    this.#localNodes.replaceChildren(
      ...this.#local.nodes.map((n) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'local-node'
        b.dataset.state = String(n.state)
        b.dataset.column = String(n.column)
        const place = at.get(n.state) ?? { x: 0, y: 0 }
        b.style.left = `${place.x}px`
        b.style.top = `${place.y}px`
        b.style.width = `${nodeWidth}px`
        b.textContent = p.states[n.state]?.name ?? String(n.state)
        b.title = b.textContent
        b.setAttribute('aria-description', this.#said(p, n.state, n.column, next))
        return b
      }),
    )
    if (had) {
      this.#paintLocal()
      this.#localNodes.querySelector<HTMLElement>('.local-node[tabindex="0"]')?.focus()
    }
    const mid = NODE_HEIGHT / 2
    const drawn: SVGElement[] = []
    for (const e of this.#local.edges) {
      const a = at.get(e.from)
      const b = at.get(e.to)
      if (a === undefined || b === undefined) continue
      let d: string
      let lx: number
      let ly: number
      if (e.from === e.to) {
        // A SELF-LOOP: out of the node's right edge, over it, and back into its top.
        const x = a.x + nodeWidth
        d = `M${x} ${a.y + 6} C${x + 22} ${a.y - 10} ${x - 12} ${a.y - 18} ${x - 20} ${a.y}`
        lx = x - 30
        ly = a.y - 8
      } else if (b.x > a.x) {
        const x1 = a.x + nodeWidth
        d = `M${x1} ${a.y + mid} C${x1 + PAD} ${a.y + mid} ${b.x - PAD} ${b.y + mid} ${b.x} ${b.y + mid}`
        lx = (x1 + b.x) / 2
        ly = (a.y + b.y) / 2 + mid - 5
      } else {
        // BACK, OR ALONG A COLUMN: under the nodes, from the bottom of one to the bottom of the other.
        const x1 = a.x + nodeWidth / 2
        const x2 = b.x + nodeWidth / 2
        const low = Math.max(a.y, b.y) + NODE_HEIGHT + 14
        d = `M${x1} ${a.y + NODE_HEIGHT} C${x1} ${low} ${x2} ${low} ${x2} ${b.y + NODE_HEIGHT}`
        lx = (x1 + x2) / 2
        ly = low
      }
      // THE FIRST PAINT COMES FROM `next`, THE SAME PLACE EVERY LATER ONE DOES (`#paintLocal`), NOT FROM
      // `e.next` — `localLevel`'s own frozen flag, kept on `LocalEdge` for the node fixtures that test
      // it directly, but a second source of truth for the drawn mark would
      // only ever agree with the first by construction, not because anything kept them in step.
      const isNext = next !== null && next.from === e.from && next.to === e.to
      drawn.push(
        svg('path', {
          d,
          class: isNext ? 'local-edge is-next' : 'local-edge',
          'data-from': String(e.from),
          'data-to': String(e.to),
        }),
      )
      const label = svg('text', { x: String(lx), y: String(ly), class: 'local-label', 'text-anchor': 'middle' })
      label.textContent = e.label
      drawn.push(label)
    }
    this.#localEdges.replaceChildren(...drawn)
  }

  /**
   * The state and target of the rule about to fire, read fresh from the frame on every call — NOT from
   * `this.#local`'s frozen layout.
   *
   * **`TmState.rule` NAMES WHAT HAPPENS NEXT, NOT WHAT PRODUCED THIS STATE** (`TmState.rule`'s own doc): a
   * loop that stays in one raw state can switch which of its rules is about to fire — a self-loop giving
   * way to its exit — without the state itself changing, and the local level does not re-lay out for that
   * (it lays out when the state changes). So the next-rule mark is repainted from here every
   * frame, in `#paintLocal`, rather than baked once into `this.#local.edges` at layout time.
   */
  #nextEdge(): { readonly from: number; readonly to: number } | null {
    const frame = this.#frame
    if (frame === null || frame.rule === null) return null
    const to = this.#program?.states[frame.state]?.rules[frame.rule]?.next
    return to === undefined ? null : { from: frame.state, to }
  }

  /**
   * What a node says beyond its name, for a reader who cannot see the level: its distance from the current state, and
   * each edge out of it with its label, the next rule's marked — the SVG that draws them is `aria-hidden`. `next` is
   * `#nextEdge`'s answer, not `this.#local.edges`' own frozen flag, so this stays right across a repaint.
   */
  #said(
    p: TmProgram,
    state: number,
    column: number,
    next: { readonly from: number; readonly to: number } | null,
  ): string {
    const where =
      column === 0
        ? 'the current state'
        : `${Math.abs(column)} ${Math.abs(column) === 1 ? 'rule' : 'rules'} ${column > 0 ? 'ahead' : 'behind'}`
    const out = this.#local.edges
      .filter((e) => e.from === state)
      .map((e) => {
        const fires = next !== null && next.from === state && next.to === e.to
        return `to ${p.states[e.to]?.name ?? e.to} on ${e.label}${fires ? ', fires next' : ''}`
      })
    return out.length === 0 ? where : `${where}; ${out.join('; ')}`
  }

  /**
   * The local level's marks and its roving tab stop: the current state, the linked ones, the active node — and,
   * every frame, the next-rule mark, repainted rather than laid out again (`#nextEdge`'s own doc).
   */
  #paintLocal(): void {
    const current = this.#frame?.state ?? null
    const next = this.#nextEdge()
    const p = this.#program
    for (const el of this.#localNodes.children) {
      if (!(el instanceof HTMLElement)) continue
      const state = Number(el.dataset.state)
      el.classList.toggle('is-current', state === current)
      if (state === current) el.setAttribute('aria-current', 'step')
      else el.removeAttribute('aria-current')
      el.classList.toggle('is-linked', this.#linkedStates.has(state))
      el.tabIndex = state === this.#localActive ? 0 : -1
      // ONLY THE CURRENT NODE'S OWN OUTGOING EDGES CAN EVER FIRE NEXT (`#nextEdge`'s `from` is always the
      // frame's state), so only its description needs redoing here — and only when it actually changed:
      // most frames repaint the same mark they already had.
      if (state === current && p !== null) {
        const column = this.#local.nodes.find((n) => n.state === state)?.column ?? 0
        const said = this.#said(p, state, column, next)
        if (el.getAttribute('aria-description') !== said) el.setAttribute('aria-description', said)
      }
    }
    for (const path of this.#localEdges.querySelectorAll<SVGPathElement>('.local-edge')) {
      const isNext = next !== null && Number(path.dataset.from) === next.from && Number(path.dataset.to) === next.to
      path.classList.toggle('is-next', isNext)
    }
  }

  /**
   * The local level's keys: ←/→ to the nearest node in the next column, ↑/↓ within a column, Enter or Space links —
   * a button's own. The focus moves with the roving tab stop, so the level stays one tab stop.
   */
  #localKey(e: KeyboardEvent): void {
    const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.local-node') : null
    if (el === null) return
    const nodes = [...this.#localNodes.querySelectorAll<HTMLElement>('.local-node')]
    const column = (n: HTMLElement) => Number(n.dataset.column)
    const inColumn = (c: number) => nodes.filter((n) => column(n) === c)
    const mine = inColumn(column(el))
    const row = mine.indexOf(el)
    let next: HTMLElement | undefined
    switch (e.key) {
      case 'ArrowUp':
        next = mine[row - 1]
        break
      case 'ArrowDown':
        next = mine[row + 1]
        break
      case 'ArrowLeft':
      case 'ArrowRight': {
        const by = e.key === 'ArrowRight' ? 1 : -1
        for (let c = column(el) + by; c >= -REACH && c <= REACH && next === undefined; c += by) {
          const there = inColumn(c)
          next = there[Math.min(row, there.length - 1)]
        }
        break
      }
      default:
        return
    }
    e.preventDefault()
    if (next === undefined) return
    this.#localActive = Number(next.dataset.state)
    this.#paintLocal()
    next.focus()
  }

  #linkRow(i: number): void {
    const row = this.#rows[i]
    if (row?.kind === 'steps') {
      this.#on.showStates?.()
      return
    }
    if (row?.kind !== 'group') return
    const first = this.#groups?.groups[row.group]?.first ?? -1
    if (first >= 0) this.#on.link(first)
  }

  /**
   * The grid's keys, the rule table's (`TmPane`'s `#key`): ↑/↓, PgUp/PgDn and Home/End move the active row by
   * index; Enter is `#linkRow`'s own — a group's row links it, the sub-steps row shows states instead — and a
   * key that scrolls detaches following before the draw that would undo it.
   */
  #key(e: KeyboardEvent): void {
    const count = this.#rows.length
    if (count === 0) return
    const page = Math.max(1, Math.floor(this.#scroll.clientHeight / ROW_HEIGHT) - 1)
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
        next = count - 1
        break
      case 'Enter':
        e.preventDefault()
        this.#linkRow(this.#active)
        return
      default:
        return
    }
    e.preventDefault()
    this.#active = Math.min(Math.max(next, 0), count - 1)
    const top = this.#active * ROW_HEIGHT
    const from = this.#scroll.scrollTop
    const to = top < from ? top : Math.max(from, top + ROW_HEIGHT - this.#scroll.clientHeight)
    if (to !== from) {
      this.#follow.detach()
      this.#scroll.scrollTop = to
      this.#on.moved?.()
    }
    this.#draw()
  }
}

/** Spec §8's ⚠: a row whose rules reach `overflow`, said in words as well as drawn. */
function warning(): HTMLElement {
  const w = document.createElement('span')
  w.className = 'program-warn'
  w.setAttribute('role', 'img')
  w.setAttribute('aria-label', 'reaches overflow')
  w.title = 'a rule here reaches overflow'
  w.textContent = '⚠'
  return w
}

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

/** Whether two program rows are the same row: a label by its name, a group by its group, and each of the others. */
function sameRow(a: ProgramRow, b: ProgramRow): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'label' && b.kind === 'label') return a.name === b.name
  if (a.kind === 'group' && b.kind === 'group') return a.group === b.group
  return true
}
