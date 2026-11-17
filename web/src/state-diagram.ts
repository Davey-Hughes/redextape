import { CAP_CHARS, layoutLocal, type Metrics } from './local-layout'
import { type Local, localLevel, predecessors, REACH } from './local-level'
import { type Arc, arcsOf, chipsOf, type Edges, type ProgramRow, programRows } from './program-level'
import { type Groups, groupStates, stepOf, type Tier } from './state-groups'
import { ROW_HEIGHT } from './state-table'
import type { TmProgram, TmState } from './types'
import { type GridRows, VirtualGrid } from './virtual-grid'
import type { VisibleWindow } from './virtual-list'

/** Pixels between two lanes of *arcs*' gutter, and the gutter's margin beside the rows. */
const LANE = 9
const GUTTER_PAD = 12
/** The runtime column's boxes: each one row tall, a row apart, and this wide. Must match `.program-box`'s `width`. */
const BOX_WIDTH = 104
const SVG = 'http://www.w3.org/2000/svg'

let minted = 0

/** How far a mouse press on the local level moves, in pixels, before it pans rather than clicks. */
const PAN_THRESHOLD = 4

/**
 * The local level's zoom (decision 12): a wheel notch, a key press, or a hundred pixels of a trackpad's wheel scale
 * it by `NOTCH`, between `ZOOM_MAX` and a floor where the whole level fits its panel, at most `ZOOM_FLOOR` and never
 * below `ZOOM_MIN`.
 */
const NOTCH = 1.1
const ZOOM_MAX = 3
const ZOOM_FLOOR = 0.5
const ZOOM_MIN = 0.05
/** A wheel's delta that makes one notch, in each of `WheelEvent.deltaMode`'s units: pixels, lines and pages. */
const PER_NOTCH = [100, 3, 1]

/** A mouse press on the local level that may yet pan it (`#panLocal`). */
interface Press {
  id: number
  x: number
  y: number
  /** The level's scroll at the press, which a pan moves from; a zoom or a reset during it moves this with the level. */
  left: number
  top: number
  onNode: boolean
  panning: boolean
}

/** `el`'s scrolled box, inside its border, as the page has it. */
function scrolledBox(el: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  const box = el.getBoundingClientRect()
  const left = box.left + el.clientLeft
  const top = box.top + el.clientTop
  return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight }
}

/**
 * How far to scroll along one axis to centre the point `at` of a drawing that runs `from`..`to` in a panel that runs
 * `start`..`end`, all as the page has them: no further than keeps the panel covered, and the drawing's own middle to
 * the panel's where the panel is the larger, so a level its panel fits is shown whole.
 */
function towards(at: number, from: number, to: number, start: number, end: number): number {
  const middle = (start + end) / 2
  if (to - from <= end - start) return (from + to) / 2 - middle
  return Math.min(Math.max(at - middle, from - start), to - end)
}

/**
 * The diagrams whose local levels are measured again when the fonts may have changed, held weakly: a diagram has no
 * teardown, and a document's listener holding one would keep a closed view's diagram alive.
 */
const measuring = new Set<WeakRef<StateDiagram>>()
/** Whether the font and style listeners are in place: once for the page, as `measuring` empties when diagrams go. */
let listening = false

/** What `m` gives a few texts that stand for the level's, to compare one measuring with another. */
const measuredAs = (m: Metrics): string =>
  [m.cap, m.ascent, m.descent, m.nodeChrome, m.nameWidth('bpf31…r1.Wq'), m.labelWidth('REG:0/1 L')].join(' ')

/**
 * Have `d` measured again when the fonts may have changed: a web font that arrives after a layout (`fonts.css` loads
 * Hack with `font-display: swap`, so a level can be laid out in a fallback first), and a style or palette picked
 * (`skin.ts`'s `applySkin` sets `data-style` and the colour tokens on `<html>`). One listener of each for every
 * diagram, for the page's life.
 */
function measureOnFontChange(d: StateDiagram): void {
  if (!listening) {
    listening = true
    const all = () => {
      for (const ref of measuring) {
        const live = ref.deref()
        if (live === undefined) measuring.delete(ref)
        else live.remeasure()
      }
    }
    document.fonts.addEventListener('loadingdone', all)
    new MutationObserver(all).observe(document.documentElement, { attributeFilter: ['data-style', 'style'] })
  }
  measuring.add(new WeakRef(d))
}

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
 * (amendment 10), the rules between them drawn and labelled; a mouse drag moves it in a panel too small for it. A
 * machine with no program level — neither instructions nor dotted names (§7's third tier) — shows it alone.
 *
 * **WHAT IS BUILT WHEN** (amendment 18). The groups, the arcs and their lanes are built once per machine
 * (`setProgram`), and the list of rows once per current group, since the current group is the one that opens onto
 * its sub-steps (`#layout`). Every draw — each frame, scroll and resize, and the view's draw when it takes the
 * focus — builds the window's row elements, the gutter's paths and the runtime column's connectors afresh, as the
 * rule table builds its rows (the grid's draw, and `#afterDraw`). The local level is laid out only when the current
 * state or its width changes, and its marks are repainted in place.
 *
 * **THE PROGRAM LEVEL IS THE RULE TABLE'S GRID** (spec §9.2, `VirtualGrid`): one tab stop, one `gridcell` per row
 * — a label's and a heading's are `rowheader`s — a roving active row by index that `aria-activedescendant` names,
 * and rows virtualized at `ROW_HEIGHT` each: `list150` compiles to 302 instructions (spec §14.1). It asks four things
 * of the grid that the rule table does not: Enter on the sub-steps row shows states, where a click only makes it
 * the active row (`enter`); the active row is found again by what it is when the rows are rebuilt (`setActive`);
 * the gutter of arcs sits beside the rows in the grid's spacer and is drawn against each window (`afterDraw`), so an
 * arc whose ends are both off the window but whose span crosses it is still drawn, clipped by the gutter's own box;
 * and the listing loses its sub-steps row when the run steps into a routine with no row (`shrinks`).
 *
 * In *arcs* each row keeps its chips' text, visually hidden: it is what the arcs say to a screen reader. *Arcs*'
 * runtime column is the program level's second tab stop, its boxes a roving group, since the routines have no rows
 * there.
 */
export class StateDiagram {
  /** The panel's body: the program level's scrolling grid, and in *arcs* the runtime column beside it. */
  readonly el: HTMLElement
  #on: DiagramEvents
  #id = `diagram-${minted++}`
  /** The program level: its box is the `role="grid"` element beside the runtime column. */
  #grid: VirtualGrid
  #gutter: SVGSVGElement
  #side: HTMLElement
  #sideLinks: SVGSVGElement
  #boxes: HTMLElement
  #programEl: HTMLElement
  #localEl: HTMLElement
  /**
   * The box the level's drawing takes on screen, at its zoom, with room around it in `#localEl` to be moved into.
   * The scroll's range is this box's size, so a drag's reach holds at any zoom.
   */
  #localContent: HTMLElement
  /** The drawing at the size it was laid out at, scaled by the zoom into `#localContent`. */
  #localDrawing: HTMLElement
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
  /**
   * The state the local level was last scrolled to centre, or `null` to centre the current one at the next draw. A
   * draw around this same state centres it again, unless the user moved the level since (`#offset`).
   */
  #centredOn: number | null = null
  /** The local level's scroll as that centring left it: a scroll anywhere else is the user's. */
  #centredAt = { left: 0, top: 0 }
  /** The local level's zoom, which a step, a new state and a resize keep (decision 12). */
  #zoom = 1
  /** The size the local level was last laid out at, which the zoom scales. */
  #drawn = { width: 0, height: 0 }
  /** A mouse press on the local level, armed or panning, or `null`. */
  #press: Press | null = null
  /** Whether a draw that would move the local level waited for a press to end (`#drawLocal`). */
  #waited = false
  /** Whether each of the last two presses on the local level panned, for a double-click to tell (`#zoomLocal`). */
  #panned: [boolean, boolean] = [false, false]
  /** The scroll the last zoom asked for, which an engine that keeps whole pixels rounds (`#zoomAt`). */
  #zoomedTo = { left: Number.NaN, top: Number.NaN }
  /** The local level's roving cursor: the state whose node holds the one tab stop. */
  #localActive: number | null = null
  /** The width the local level was last laid out for. */
  #localWidth = 0
  /** The canvas `#measure` sets text on, made on the first layout. */
  #canvas: CanvasRenderingContext2D | undefined
  /** What the level was last laid out with (`measuredAs`), so a font load that changes none of it lays nothing out. */
  #measured = ''
  #linkedStates: Set<number> = new Set()
  #frame: TmState | null = null
  /** The current group, or `null` with no frame, and for the `overflow` state, which is a badge. */
  #current: number | null = null
  #rows: ProgramRow[] = []
  /** `#rowOf[group]` is the group's row in `#rows`, or `-1` when it has none (a runtime routine in *arcs*). */
  #rowOf: Int32Array = new Int32Array(0)
  #linked: Set<number> = new Set()
  /** The runtime column's roving tab stop: the group whose box holds it, or `null` for the first box. */
  #activeBox: number | null = null

  constructor(on: DiagramEvents) {
    this.#on = on
    this.el = document.createElement('div')
    this.el.className = 'state-diagram'
    const program = document.createElement('div')
    program.className = 'program-level'

    this.#grid = new VirtualGrid({
      classes: { box: 'program-scroll', spacer: 'program-spacer', rows: 'program-rows', row: 'program-row' },
      idPrefix: this.#id,
      // OPEN WHILE ITS BOX HAS A HEIGHT, which covers every way it is not on screen: the diagram's panel closed, the
      // local level shown in its place, and the view off the page. The pane knows only the first.
      isOpen: () => this.#grid.el.clientHeight !== 0,
      rows: () => this.#gridRows(),
      // A CLICK LINKS A GROUP'S ROW AND DOES NOTHING ELSE: a click on a sub-step, or on a label, is only a click on a
      // row. *Show states* is its button's (`#fill`), or Enter's on its row.
      activate: (i) => {
        if (this.#rows[i]?.kind === 'group') this.#linkRow(i)
      },
      enter: (i) => this.#linkRow(i),
      afterDraw: (w) => this.#afterDraw(w),
      shrinks: true,
    })
    this.#grid.el.setAttribute('aria-label', 'program')
    // *ARCS*' GUTTER SCROLLS WITH THE ROWS, so it sits in the grid's spacer, ahead of them; `#afterDraw` moves the
    // rows right of it.
    this.#gutter = document.createElementNS(SVG, 'svg')
    this.#gutter.classList.add('program-gutter')
    this.#gutter.setAttribute('aria-hidden', 'true')
    this.#grid.rowsEl.before(this.#gutter)

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

    program.append(this.#grid.el, this.#side)
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
    this.#localDrawing = document.createElement('div')
    this.#localDrawing.className = 'local-drawing'
    this.#localDrawing.append(this.#localEdges, this.#localNodes)
    this.#localContent = document.createElement('div')
    this.#localContent.className = 'local-content'
    this.#localContent.append(this.#localDrawing)
    this.#localEl.append(this.#localContent)
    // NO TAB STOP OF ITS OWN: Firefox makes one of a scroller with somewhere to scroll, which the room always gives,
    // and it would be an unnamed stop ahead of the nodes, the level's one stop. A node's focus still scrolls it.
    this.#localEl.tabIndex = -1
    this.#localNodes.addEventListener('click', (e) => {
      const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.local-node') : null
      if (el === null) return
      this.#localActive = Number(el.dataset.state)
      // THE CLICKED NODE TAKES THE FOCUS, as its press does not, the level being one a drag moves (`#panLocal`). NO
      // RING, as a press's own focus draws none: a scripted focus draws one wherever the focus was last the keyboard's.
      el.focus({ preventScroll: true, focusVisible: false })
      // PAINTED BEFORE LINKING, as the program level's row click and the rule table's row click both are: `link`
      // can return early for a pane that is nothing else's to link, and the clicked node should hold the tab
      // stop regardless — not stay at `tabIndex -1` because the paint that would have moved it never ran.
      this.#paintLocal()
      this.#on.link(Number(el.dataset.state))
    })
    this.#localNodes.addEventListener('keydown', (e) => this.#localKey(e))
    // THE LOCAL LEVEL IS LAID OUT FOR A WIDTH, so a width it was not laid out for lays it out again — a divider
    // drag, a window resize. The panel's own reopening goes through its `onToggle`'s `redraw()` instead of this.
    // ITS BORDER BOX, which is all the width it is laid out for: it draws no scroll bar to take any (style.css), and
    // its content does not size it (`container-type`), so a layout cannot change what this observes. Any change of
    // size, a height's too, places the level again: centred, unless the user moved it (`#drawLocal`).
    new ResizeObserver(() => {
      if (this.#localEl.clientWidth !== this.#localWidth) this.#localAround = null
      if (this.shown === 'local') this.#drawLocal(true)
    }).observe(this.#localEl, { box: 'border-box' })
    this.el.append(program, this.#localEl)
    this.#panLocal()
    this.#zoomLocal()
    measureOnFontChange(this)

    // THE PANE'S RE-ATTACH GOES WITH THE GRID'S FOLLOWING, which a user's scroll and a key that scrolls change. Told
    // after the grid's own listeners, registered first in its constructor, have acted on the event; not for a box that
    // is not on screen, whose scroll the grid ignores.
    const moved = () => {
      if (this.#grid.el.clientHeight !== 0) this.#on.moved?.()
    }
    this.#grid.el.addEventListener('scroll', moved)
    this.#grid.el.addEventListener('keydown', moved)
    this.#boxes.addEventListener('click', (e) => {
      const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.program-box') : null
      if (el === null) return
      this.#activeBox = Number(el.dataset.group)
      this.#paintBoxes()
      const first = this.#groups?.groups[Number(el.dataset.group)]?.first
      if (first !== undefined && first >= 0) this.#on.link(first)
    })
    this.#boxes.addEventListener('keydown', (e) => this.#boxKey(e))
  }

  /**
   * Whether the program level follows the running state; a user scroll or a key that scrolls detaches it. The local
   * level always follows — it is drawn around the current state — so it says so.
   */
  get following(): boolean {
    return this.shown === 'local' || this.#grid.following
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
    this.#centredOn = null
    this.#localActive = null
    this.#linkedStates = new Set()
    this.#groups = p === null ? null : groupStates(p)
    this.#arcs = this.#groups === null ? [] : arcsOf(this.#groups)
    this.#lanes = this.#arcs.reduce((n, a) => Math.max(n, a.lane + 1), 0)
    this.#linked = new Set()
    this.#current = null
    this.#frame = null
    this.#activeBox = null
    // The first row active, following on, and the grid at the top — `VirtualGrid.reset`'s doc says why its scroll is
    // recorded before it is written.
    this.#grid.reset()
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
    // page: *show states* in the grid would move it to `<body>`. It moves to the shown level's own tab stop.
    const had = this.el.contains(document.activeElement)
    this.#level = level
    this.#centredOn = null
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
    this.#grid.attach()
  }

  /**
   * Lay the local level out again if its text measures differently than when it was laid out: a web font arrived, or
   * the style changed. Its boxes are sized to their names, and its gaps to their labels, in the widths measured then.
   */
  remeasure(): void {
    if (this.#localAround === null || measuredAs(this.#measure()) === this.#measured) return
    this.#localAround = null
    if (this.shown === 'local') this.#drawLocal()
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
    if (this.shown === 'program') this.#grid.el.focus()
    else (this.#localNodes.querySelector<HTMLElement>('.local-node[tabindex="0"]') ?? this.#localNodes).focus()
  }

  /** Rebuild the rows — a new machine, a new current group, or the other rendering — and draw them. */
  #layout(): void {
    const groups = this.#groups
    // THE ACTIVE ROW IS A ROW, NOT A PLACE: the sub-steps row moves with the current group and shifts every row
    // between its old place and its new one, so the active row is found again by what it is.
    const was = this.#rows[this.#grid.active]
    this.#rows = groups === null ? [] : programRows(groups, this.#program?.labels ?? [], this.#edges, this.#current)
    if (was !== undefined) {
      const again = this.#rows.findIndex((r) => sameRow(r, was))
      if (again >= 0) this.#grid.setActive(again)
    }
    this.#rowOf = new Int32Array(groups?.groups.length ?? 0).fill(-1)
    for (const [i, row] of this.#rows.entries()) if (row.kind === 'group') this.#rowOf[row.group] = i
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
   * Draw the program level: the grid's rows in view, and `#afterDraw`'s arcs across them and connectors beside them.
   * The grid also draws on its own for a scroll, a resize, a key and a click.
   */
  #draw(): void {
    this.#grid.draw()
    if (this.#groups !== null) return
    // NO MACHINE, NO ROWS, EVEN HIDDEN: a program level emptied behind the local level, a closed panel or another
    // Stage tab would otherwise keep the last machine's rows, with `aria-activedescendant` naming one (`clear`).
    this.#grid.clear()
    // NO MACHINE, NO ARCS: `#afterDraw` draws nothing for a `null` compile, so the gutter otherwise keeps the LAST
    // machine's paths and size, extending the scrollable region past the now-emptied spacer — a scroll range with
    // nothing in it. Removing `width`/`height` is not enough: an `<svg>` with neither falls back to its own 300×150
    // box, which still reaches past the diagram once the window was scrolled before the machine emptied — setting both
    // to `'0'` is what actually empties it. Its `top`, left at the old window's offset, needs no reset alongside them:
    // a zero-sized box adds nothing to the scrollable region at any offset. The side column's connectors are the same
    // leftover, one step removed: `#drawBoxes` already clears its boxes and hides the column on every `setProgram`,
    // but `#drawLinks`, which draws these, only runs from `#afterDraw`, so they are cleared here too.
    this.#gutter.replaceChildren()
    this.#gutter.setAttribute('width', '0')
    this.#gutter.setAttribute('height', '0')
    this.#sideLinks.replaceChildren()
  }

  /** What one draw of the program level's grid shows: a row per entry of `#rows`, following the current group's. */
  #gridRows(): GridRows {
    const groups = this.#groups
    const current = this.#current === null ? -1 : (this.#rowOf[this.#current] ?? -1)
    return {
      // NO MACHINE IS A GRID OF NO ROWS, NOT NO GRID: the program level is still drawn, empty, and says so with an
      // `aria-rowcount` of 0 rather than `null`'s none.
      count: this.#rows.length,
      // A runtime routine in *arcs* has no row, so a run inside one is followed nowhere: its box is marked instead.
      follow: current >= 0 ? current : null,
      frame: this.#frame?.step ?? null,
      fill: (i, row, cell) => {
        if (groups !== null) this.#fill(i, row, cell, groups)
      },
    }
  }

  /**
   * What each draw of the grid paints beside its rows, against the window it drew: the rows moved right of *arcs*'
   * gutter, the arcs across them, the runtime column's connectors, and its boxes' marks. O(arcs + edges) on every
   * frame, scroll and resize, not only O(visible rows), since `#drawArcs` walks every arc and `#drawLinks` every
   * group's targets on each call.
   */
  #afterDraw(w: VisibleWindow): void {
    const groups = this.#groups
    if (groups === null) return
    const gutter = this.#edges === 'arcs' && this.#lanes > 0 ? this.#lanes * LANE + GUTTER_PAD : 0
    this.#grid.rowsEl.style.left = `${gutter}px`
    this.#drawArcs(w.firstIndex, w.lastIndex, w.offsetY, gutter)
    this.#drawLinks(groups)
    // THE RUNTIME COLUMN'S BOXES CARRY THE ROWS' MARKS: in *arcs* a routine has no row, so its box is where the
    // machine is when it is inside one, and where a link into one lands.
    this.#paintBoxes()
  }

  /** Fill row `i` of the grid — `GridRows.fill` — with its text and marks; a label's or a heading's cell names rows. */
  #fill(i: number, el: HTMLElement, cell: HTMLElement, groups: Groups): void {
    const row = this.#rows[i] as ProgramRow
    cell.className = 'program-cell'
    if (row.kind === 'label' || row.kind === 'heading') cell.setAttribute('role', 'rowheader')
    switch (row.kind) {
      case 'label':
      case 'heading':
        el.classList.add(row.kind === 'label' ? 'is-label' : 'is-heading')
        cell.textContent = row.kind === 'label' ? `${row.name}:` : row.name
        return
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
        // *SHOW STATES* IS ITS BUTTON'S CLICK, NOT ITS ROW'S: stopped here, before the grid's handler on the rows, so
        // the row does not become the active one. The focus first, as `mousedown` would have moved it had the grid
        // not stopped that (`VirtualGrid`'s constructor), so the hand-off in `setLevel` finds it in this level and
        // moves it to the next — never leaving it on the page.
        show.addEventListener('click', (e) => {
          e.stopPropagation()
          this.#grid.el.focus({ preventScroll: true })
          this.#on.showStates?.()
        })
        cell.append(show)
        const now = this.#frame === null ? null : stepOf(this.#program?.states[this.#frame.state]?.name ?? '')
        for (const step of groups.groups[row.group]?.steps ?? []) {
          const s = document.createElement('span')
          s.className = step === now ? 'program-step is-now' : 'program-step'
          s.textContent = step
          cell.append(s)
        }
        return
      }
      case 'group': {
        const g = groups.groups[row.group]
        if (g === undefined) return
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
        // THE COUNT IS ITS NUMBER AND ITS UNIT, EACH IN A BOX OF ITS OWN, AND ITS TEXT IS STILL `53 states`: a row with
        // too little room cuts the unit, never the number, which is drawn whole or not at all (`style.css`'
        // `.program-count-number`). Cut as one text, `53 states` in a box of 9px would read `5.`, another number.
        const count = document.createElement('span')
        count.className = 'program-count'
        const number = document.createElement('span')
        number.className = 'program-count-number'
        number.textContent = String(g.count)
        const unit = document.createElement('span')
        unit.className = 'program-count-unit'
        const word = document.createElement('span')
        word.className = 'program-count-word'
        word.textContent = g.count === 1 ? ' state' : ' states'
        unit.append(word)
        count.append(number, unit)
        cell.append(count)
        return
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
    const height = this.#grid.el.clientHeight
    this.#sideLinks.setAttribute('height', String(height))
    const boxOf = new Map<number, number>()
    let k = 0
    for (const [i, g] of groups.groups.entries()) if (g.runtime) boxOf.set(i, k++)
    const boxY = (g: number) => (boxOf.get(g) ?? 0) * ROW_HEIGHT + ROW_HEIGHT / 2
    const rowY = (g: number) => (this.#rowOf[g] ?? 0) * ROW_HEIGHT + ROW_HEIGHT / 2 - this.#grid.el.scrollTop
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
   * free (spec §8) — and paint its marks. `resized` when its panel changed size, which places it again.
   */
  #drawLocal(resized = false): void {
    const p = this.#program
    const current = this.#frame?.state ?? null
    // NOTHING WHILE IT IS NOT DRAWN — a closed panel, a view off the page: a layout there would be for no width at
    // all, and it is marked stale so the next one on screen lays it out.
    if (this.#localEl.clientWidth === 0) {
      this.#localAround = null
      this.#centredOn = null
      return
    }
    if (p === null || current === null) {
      // THE FOCUS GOES WITH THE LEVEL HERE TOO (`setLevel`'s own reason): a node holding it is about to be
      // removed, and a removed element's focus falls to the page rather than following it anywhere. With
      // every node gone, `#focusShown`'s local branch falls back to `#localNodes` itself.
      const had = this.#localNodes.contains(document.activeElement)
      this.#localNodes.replaceChildren()
      this.#localEdges.replaceChildren()
      // NOTHING LEFT TO SCROLL OR DRAG: the last drawing's size would keep a scroll range, and the open hand, over a
      // level with nothing in it.
      this.#drawn = { width: 0, height: 0 }
      this.#sizeLocal()
      this.#localEdges.setAttribute('width', '0')
      this.#localEdges.setAttribute('height', '0')
      this.#localEl.removeAttribute('data-pans')
      this.#localAround = null
      this.#centredOn = null
      if (had) this.#focusShown()
      return
    }
    // A NEW STATE IS CENTRED; A LAYOUT OR A RESIZE AROUND THE SAME ONE CENTRES IT AGAIN, OR KEEPS IT WHERE THE USER
    // MOVED IT (decision 11). A step that stays in the state does neither, and costs no measuring.
    const same = current === this.#centredOn
    const stale = current !== this.#localAround
    if (same && !stale && !resized) {
      this.#paintLocal()
      return
    }
    // NOTHING THAT MOVES THE LEVEL WHILE A MOUSE PRESS IS ON IT: a pan sets the scroll from where its press began, so
    // a placing under it shows for a frame and is undone by the next move, and a layout would change what is under
    // the pointer. The release draws what waited (`#panLocal`), centring a state that came during the press.
    if (this.#press !== null) {
      this.#waited = true
      return
    }
    // READ BEFORE THE LAYOUT, which replaces the node it is measured from.
    const kept = same ? this.#offset(current) : null
    if (stale) {
      this.#localAround = current
      this.#layoutLocal(p, current)
    }
    this.#place(current, kept)
    this.#paintLocal()
  }

  /**
   * Build the level around `current`, place the nodes in their columns and draw the edges between them
   * (`local-layout.ts`).
   */
  #layoutLocal(p: TmProgram, current: number): void {
    // A NODE HOLDING THE FOCUS IS REBUILT BELOW, AND ITS FOCUS WOULD FALL TO THE PAGE: it goes to the active node.
    const had = this.#localNodes.contains(document.activeElement)
    this.#localWidth = this.#localEl.clientWidth
    const nameOf = (s: number) => p.states[s]?.name ?? String(s)
    const rule = this.#frame?.rule ?? null
    // THE PANEL'S WHOLE WIDTH, WHICH NO SCROLL BAR TAKES ANY OF (`.local-level` in style.css): the spread changes the
    // level's height, and a width that changed with the height would lay it out again every frame.
    const metrics = this.#measure()
    this.#measured = measuredAs(metrics)
    const local = localLevel(p, this.#into, current, rule, this.#names)
    const layout = layoutLocal(local, nameOf, metrics, this.#localWidth)
    this.#local = local
    if (this.#localActive === null || !local.nodes.some((n) => n.state === this.#localActive)) {
      this.#localActive = current
    }
    this.#drawn = { width: layout.width, height: layout.height }
    this.#sizeLocal()
    this.#localEdges.setAttribute('width', String(layout.width))
    this.#localEdges.setAttribute('height', String(layout.height))
    // COMPUTED ONCE HERE, FOR THE FIRST PAINT: `#paintLocal`, called right after this returns, repaints it
    // fresh on every later frame — see `#nextEdge`'s own doc for why a layout cannot just bake it in.
    const next = this.#nextEdge()
    this.#localNodes.replaceChildren(
      ...layout.nodes.map((n) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'local-node'
        b.dataset.state = String(n.state)
        b.dataset.column = String(n.column)
        b.style.left = `${n.x}px`
        b.style.top = `${n.y}px`
        b.style.width = `${n.width}px`
        b.textContent = n.text
        // THE WHOLE NAME, WHICHEVER PART OF IT SHOWS: on hover, and as the name a reader is read, so a cut name
        // is never all that a screen reader says.
        b.title = nameOf(n.state)
        b.setAttribute('aria-label', b.title)
        b.setAttribute('aria-description', this.#said(p, n.state, n.column, next))
        return b
      }),
    )
    // WITHOUT SCROLLING: the level's scroll is the centring's or the user's (`#drawLocal`), not the focus's.
    if (had) {
      this.#paintLocal()
      this.#localNodes.querySelector<HTMLElement>('.local-node[tabindex="0"]')?.focus({ preventScroll: true })
    }
    const drawn: SVGElement[] = []
    for (const e of layout.edges) {
      // THE FIRST PAINT COMES FROM `next`, THE SAME PLACE EVERY LATER ONE DOES (`#paintLocal`), NOT FROM
      // `e.next` — `localLevel`'s own frozen flag, kept on `LocalEdge` for the node fixtures that test
      // it directly, but a second source of truth for the drawn mark would
      // only ever agree with the first by construction, not because anything kept them in step.
      const isNext = next !== null && next.from === e.from && next.to === e.to
      const ends = { 'data-from': String(e.from), 'data-to': String(e.to) }
      drawn.push(svg('path', { d: e.d, class: isNext ? 'local-edge is-next' : 'local-edge', ...ends }))
      const { label } = e
      const text = svg('text', { class: 'local-label', 'text-anchor': label.anchor, ...ends })
      for (const [i, line] of label.lines.entries()) {
        const span = svg('tspan', { x: String(label.x), y: String(label.baselines[i] ?? 0) })
        span.textContent = line
        text.append(span)
      }
      drawn.push(text)
    }
    this.#localEdges.replaceChildren(...drawn)
    // A DRAWN LEVEL IS ONE A DRAG MOVES, whatever its size, for `#panLocal` and the stylesheet's open hand.
    this.#localEl.setAttribute('data-pans', '')
  }

  /** The local level's node for `state`, or `null` where the level has none. */
  #nodeOf(state: number): HTMLElement | null {
    return this.#localNodes.querySelector<HTMLElement>(`.local-node[data-state="${state}"]`)
  }

  /**
   * Where the user moved `state`'s node to, from the middle of the panel, or `null` where nothing has scrolled the
   * local level since it was last centred: a drag, the wheel, a finger or a focus brought into view all scroll it.
   */
  #offset(state: number): { x: number; y: number } | null {
    const el = this.#localEl
    const at = this.#centredAt
    if (Math.abs(el.scrollLeft - at.left) <= 0.5 && Math.abs(el.scrollTop - at.top) <= 0.5) return null
    const node = this.#nodeOf(state)
    if (node === null) return null
    const v = scrolledBox(el)
    const r = node.getBoundingClientRect()
    return { x: r.left + r.width / 2 - (v.left + v.right) / 2, y: r.top + r.height / 2 - (v.top + v.bottom) / 2 }
  }

  /**
   * Scroll the local level so `state`'s node is `kept` from the middle of the panel, where the user left it, or with
   * `kept` null, centre it (`towards`) and remember that. The browser holds either to the scroll's range, which puts a
   * corner of the drawing at the panel's middle at its ends (`.local-content` in style.css).
   */
  #place(state: number, kept: { x: number; y: number } | null): void {
    const node = this.#nodeOf(state)
    if (node === null) return
    const el = this.#localEl
    const v = scrolledBox(el)
    const r = node.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    if (kept !== null) {
      el.scrollLeft += x - (v.left + v.right) / 2 - kept.x
      el.scrollTop += y - (v.top + v.bottom) / 2 - kept.y
      return
    }
    const k = this.#localContent.getBoundingClientRect()
    el.scrollLeft += towards(x, k.left, k.right, v.left, v.right)
    el.scrollTop += towards(y, k.top, k.bottom, v.top, v.bottom)
    this.#centredOn = state
    this.#centredAt = { left: el.scrollLeft, top: el.scrollTop }
  }

  /**
   * A mouse drag on the local level, on its background or a node, moves it in its panel both ways, at any size
   * (decisions 10 and 11). A press is a click until it has moved more than `PAN_THRESHOLD` px, so a click on a node
   * still links it; one that moved further pans, captures the pointer, and neither links nor moves the roving tab
   * stop. A pen and a finger keep the browser's own scrolling, which the level's room to move gives as much reach.
   */
  #panLocal(): void {
    const el = this.#localEl
    // THE MOVES AND THE RELEASE ARE HEARD ON THE DOCUMENT: before the threshold there is no capture, and a move that
    // leaves the level in one step would not pan, or a release off it would leave the press armed for later moves.
    const move = (e: PointerEvent) => {
      const press = this.#press
      if (press === null || e.pointerId !== press.id) return
      // NO BUTTON HELD IS A RELEASE THE PAGE NEVER HEARD, one in another window say: the press is over, or the level
      // would follow a pointer that holds nothing, and every draw waiting for the press would wait on.
      if ((e.buttons & 1) === 0) {
        stop(press, false)
        return
      }
      const dx = e.clientX - press.x
      const dy = e.clientY - press.y
      if (!press.panning) {
        if (Math.hypot(dx, dy) <= PAN_THRESHOLD) return
        press.panning = true
        el.dataset.dragging = 'true'
        // CAPTURED ONCE IT PANS, AND NOT BEFORE: a captured release sends its click to the level rather than to the
        // node under the pointer, which a pan keeps under it, so a pan links nothing and a click still links.
        el.setPointerCapture(e.pointerId)
      }
      el.scrollLeft = press.left - dx
      el.scrollTop = press.top - dy
    }
    const end = (e: PointerEvent) => {
      const press = this.#press
      if (press === null || e.pointerId !== press.id) return
      stop(press, e.type === 'pointerup')
    }
    // A WINDOW THAT LOSES THE FOCUS MAY NEVER HEAR THE RELEASE, which comes to the window that took it.
    const blur = () => {
      if (this.#press !== null) stop(this.#press, false)
    }
    /** End `press`; `released` when by its own release, which may make it a click. */
    const stop = (press: Press, released: boolean) => {
      this.#press = null
      this.#panned = [this.#panned[1], press.panning]
      el.ownerDocument.removeEventListener('pointermove', move, true)
      el.ownerDocument.removeEventListener('pointerup', end, true)
      el.ownerDocument.removeEventListener('pointercancel', end, true)
      el.ownerDocument.defaultView?.removeEventListener('blur', blur)
      // WHAT WAITED FOR THE PRESS IS DRAWN IN A LATER FRAME, after the release's click: a layout now would replace the
      // node the click is on, and the click would link nothing.
      if (this.#waited) {
        this.#waited = false
        requestAnimationFrame(() => {
          if (this.shown === 'local') this.#drawLocal(true)
        })
      }
      if (!press.panning) {
        // A CLICK ON THE BACKGROUND TAKES THE FOCUS INTO THE LEVEL, to its tab stop and with no ring, as a press's own
        // focus would: that is stopped below, and typing would otherwise go on editing wherever the focus was. A
        // node's click focuses the node.
        if (released && !press.onNode) {
          const stop = this.#localNodes.querySelector<HTMLElement>('.local-node[tabindex="0"]') ?? this.#localNodes
          stop.focus({ preventScroll: true, focusVisible: false })
        }
        return
      }
      delete el.dataset.dragging
      if (el.hasPointerCapture(press.id)) el.releasePointerCapture(press.id)
    }
    // A CAPTURE THE BROWSER TOOK BACK IS A PRESS WHOSE RELEASE MAY NEVER REACH THE LEVEL.
    el.addEventListener('lostpointercapture', end)
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || !el.hasAttribute('data-pans')) return
      const onNode = e.target instanceof Element && e.target.closest('.local-node') !== null
      this.#press = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: el.scrollLeft,
        top: el.scrollTop,
        onNode,
        panning: false,
      }
      el.ownerDocument.addEventListener('pointermove', move, true)
      el.ownerDocument.addEventListener('pointerup', end, true)
      el.ownerDocument.addEventListener('pointercancel', end, true)
      el.ownerDocument.defaultView?.addEventListener('blur', blur)
      // NO TEXT SELECTED AND NO FOCUS MOVED BY A PRESS THAT MAY BE A PAN: both are its `mousedown`'s, which this
      // stops. A click focuses its node, or the level, itself.
      e.preventDefault()
    })
  }

  /**
   * The local level's zoom (decision 12): the wheel, and a pinch, which browsers send as a wheel with Ctrl, scale the
   * drawing about the pointer; a double-click on its background puts it back at full size, centred on the current
   * state; with the focus in it, `+` or `=` and `-` zoom about the panel's middle and `0` is the double-click's.
   */
  #zoomLocal(): void {
    const el = this.#localEl
    // NOT PASSIVE, SO IT CAN BE STOPPED: the wheel over the drawing is the drawing's, so it neither scrolls the view
    // around it nor, with Ctrl, zooms the page.
    el.addEventListener(
      'wheel',
      (e) => {
        if (!el.hasAttribute('data-pans')) return
        e.preventDefault()
        // `deltaY` READ BEFORE `deltaMode`, which in Firefox then gives pixels rather than lines; either is a notch.
        const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
        const notches = delta / (PER_NOTCH[e.deltaMode] ?? 1)
        this.#zoomAt(this.#zoom * NOTCH ** -notches, { x: e.clientX, y: e.clientY })
      },
      { passive: false },
    )
    el.addEventListener('dblclick', (e) => {
      if (e.target instanceof Element && e.target.closest('.local-node') !== null) return
      // TWO CLICKS, NOT A DRAG AND A CLICK: a drag's release clicks the level it captured, and a press soon after at
      // the same spot is counted the second of a double-click, which would reset a zoom the user is moving around in.
      if (this.#panned[0] || this.#panned[1]) return
      this.#unzoom()
    })
    el.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !el.hasAttribute('data-pans')) return
      const v = scrolledBox(el)
      const middle = { x: (v.left + v.right) / 2, y: (v.top + v.bottom) / 2 }
      if (e.key === '+' || e.key === '=') this.#zoomAt(this.#zoom * NOTCH, middle)
      else if (e.key === '-') this.#zoomAt(this.#zoom / NOTCH, middle)
      else if (e.key === '0') this.#unzoom()
      else return
      e.preventDefault()
    })
  }

  /**
   * Zoom the local level towards `to`, keeping the point of the drawing at `at`, a point on the page, where it is. Held
   * to the range (`ZOOM_MAX` and the floor): a zoom already past an end, as a step or a resize can leave one, is moved
   * no further past it, and not pulled back to it in one jump.
   */
  #zoomAt(to: number, at: { x: number; y: number }): void {
    const el = this.#localEl
    const { width, height } = this.#drawn
    if (width === 0 || height === 0) return
    const from = this.#zoom
    const fits = Math.min(el.clientWidth / width, el.clientHeight / height)
    const floor = Math.max(ZOOM_MIN, Math.min(ZOOM_FLOOR, fits))
    const zoom = Math.min(Math.max(to, Math.min(floor, from)), Math.max(ZOOM_MAX, from))
    if (zoom === from) return
    // READ BEFORE THE RESIZE, which can take the scroll in to a smaller range on its own.
    const k = this.#localContent.getBoundingClientRect()
    // FROM THE SCROLL THE LAST ZOOM ASKED FOR while the level is within a pixel of it, which is a rounding and not a
    // move or the range's end: an engine rounds each zoom's scroll, and a trackpad's run of small zooms would add the
    // roundings up and move the point under the pointer.
    const z = this.#zoomedTo
    const left = Math.abs(el.scrollLeft - z.left) < 1 ? z.left : el.scrollLeft
    const top = Math.abs(el.scrollTop - z.top) < 1 ? z.top : el.scrollTop
    // THE DRAWING'S CORNER WHERE THAT SCROLL PUTS IT.
    const x = k.left + el.scrollLeft - left
    const y = k.top + el.scrollTop - top
    this.#zoom = zoom
    this.#sizeLocal()
    const toLeft = left + ((at.x - x) / from) * (zoom - from)
    const toTop = top + ((at.y - y) / from) * (zoom - from)
    el.scrollLeft = toLeft
    el.scrollTop = toTop
    this.#zoomedTo = { left: toLeft, top: toTop }
    this.#rebase(left, top)
  }

  /** Put the local level back at full size, centred on the current state as a new one is. */
  #unzoom(): void {
    const current = this.#frame?.state ?? null
    if (this.#drawn.width === 0 || current === null) return
    const left = this.#localEl.scrollLeft
    const top = this.#localEl.scrollTop
    this.#zoom = 1
    this.#sizeLocal()
    this.#place(current, null)
    this.#rebase(left, top)
  }

  /**
   * A PAN UNDER WAY GOES ON FROM WHERE A ZOOM OR A RESET LEFT THE LEVEL, scrolled from `left`, `top`: its next move sets
   * the scroll from its press's, which would otherwise undo the zoom's scroll in one jump.
   */
  #rebase(left: number, top: number): void {
    if (this.#press === null) return
    this.#press.left += this.#localEl.scrollLeft - left
    this.#press.top += this.#localEl.scrollTop - top
  }

  /** Size the local level's drawing at its zoom: the box it takes on screen, and the scale that fills it. */
  #sizeLocal(): void {
    const { width, height } = this.#drawn
    const z = this.#zoom
    this.#localContent.style.width = `${width * z}px`
    this.#localContent.style.height = `${height * z}px`
    this.#localDrawing.style.width = `${width}px`
    this.#localDrawing.style.height = `${height}px`
    // A TRANSFORM, NOT A LAYOUT AT ANOTHER SIZE: the drawing scales as one, every box, line and label in proportion,
    // where text set at a scaled font size is not, and a cut name could then outgrow its box. It is drawn afresh at
    // each scale, so it stays sharp.
    this.#localDrawing.style.transform = z === 1 ? '' : `scale(${z})`
  }

  /**
   * The level's fonts as `layoutLocal` needs them, read from a node and a label as style.css sets them, so a style
   * that changes the font changes what is measured. A canvas measures the text: it does not lay the page out, as a
   * hidden element would once for every cut a name is tried at.
   */
  #measure(): Metrics {
    const node = document.createElement('button')
    node.className = 'local-node is-current'
    node.hidden = true
    const label = svg('text', { class: 'local-label' })
    this.#localNodes.append(node)
    this.#localEdges.append(label)
    const ns = getComputedStyle(node)
    const ls = getComputedStyle(label)
    const px = (v: string) => Number.parseFloat(v) || 0
    const nodeFont = `${ns.fontStyle} ${ns.fontWeight} ${ns.fontSize} ${ns.fontFamily}`
    const labelFont = `${ls.fontStyle} ${ls.fontWeight} ${ls.fontSize} ${ls.fontFamily}`
    const chrome = px(ns.paddingLeft) + px(ns.paddingRight) + px(ns.borderLeftWidth) + px(ns.borderRightWidth)
    node.remove()
    label.remove()
    // A NEW CANVAS ALWAYS HAS A 2D CONTEXT: `null` is only for a canvas that already has another kind.
    this.#canvas ??= document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
    const ctx = this.#canvas
    const width = (font: string) => (s: string) => {
      ctx.font = font
      return ctx.measureText(s).width
    }
    ctx.font = labelFont
    const metrics = ctx.measureText('0')
    const nameWidth = width(nodeFont)
    return {
      nameWidth,
      labelWidth: width(labelFont),
      ascent: metrics.fontBoundingBoxAscent,
      descent: metrics.fontBoundingBoxDescent,
      nodeChrome: chrome,
      cap: nameWidth('0'.repeat(CAP_CHARS)),
    }
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
        const on = e.labels.map((l) => l.join(' ')).join(', ')
        return `to ${p.states[e.to]?.name ?? e.to} on ${on}${fires ? ', fires next' : ''}`
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
