import { centredScrollTop, Follow, ROW_HEIGHT } from './state-table'
import { type VisibleWindow, visibleWindow } from './virtual-list'

/** Rows drawn beyond the viewport on each side, so a fast scroll does not show blank space. */
export const OVERSCAN = 4

/**
 * What one draw of a grid shows: how many rows there are, which one following keeps centred, and how to fill a row.
 *
 * **ONE SNAPSHOT PER DRAW, NOT A METHOD PER QUESTION.** A view works out its marks once for a frame — the TM rule
 * table's `highlight` finds the current state's row and the next rule's together — and both the row following
 * centres and each drawn row's classes read them. Asked through separate callbacks, the view would compute them
 * once per question or cache them itself between calls it cannot see the order of.
 */
export type GridRows = {
  /**
   * The rows there are, or `null` for no content at all — which clears the grid and drops `aria-rowcount`, where
   * `0` would announce an empty grid that is there.
   */
  readonly count: number | null
  /** The row following keeps centred, or `null` for none this draw. */
  readonly follow: number | null
  /**
   * The frame this draw shows — a view's step number — or `null` when it has none. **REQUIRED, NOT
   * OPTIONAL**, so a view cannot silently fall back to keying the hold on `follow` alone by omitting it:
   * a link's scroll hold (`VirtualGrid.scrollToRow`) is keyed on this field, because a view whose follow
   * row is the current run's position — the TM rule table's state header — can show a NEW frame at the
   * SAME follow row, a self-looping step being the ordinary case (amendment 21). Each view's grid keys
   * its own hold on its own frame; this is this draw's own.
   */
  readonly frame: number | null
  /**
   * Fill row `i`: `row` is its `role="row"` element and `cell` its one `role="gridcell"`, both already carrying
   * their roles, `aria-rowindex` and the cell's id. The view adds its classes, marks and text; the grid adds
   * `is-active` afterwards. **THE CELL'S ROLE IS THE VIEW'S TO CHANGE**, and nothing the grid does after this
   * sets it again: a row that names the rows under it — the state diagram's labels — makes its cell a `rowheader`.
   */
  fill(i: number, row: HTMLElement, cell: HTMLElement): void
}

/** How a grid is named and styled, and what it asks of the view that owns it. */
export type GridOptions = {
  /** The class names of the scroll box, the spacer inside it, the rows' container and each row. */
  readonly classes: { readonly box: string; readonly spacer: string; readonly rows: string; readonly row: string }
  /** The prefix of each cell's id, unique to this grid: the id `aria-activedescendant` names is `${idPrefix}-${i}`. */
  readonly idPrefix: string
  /** Whether the panel holding the grid is open. A closed grid draws nothing that reads the layout, and takes no scroll as a user's. */
  readonly isOpen: () => boolean
  /** The rows to draw, asked once at every draw. */
  readonly rows: () => GridRows
  /** A click on row `i`, or Enter on it as the active row when the view gives no `enter`. */
  readonly activate: (i: number) => void
  /**
   * Enter on row `i` as the active row, for a view whose row does one thing for the key and another for a pointer:
   * the state diagram's sub-steps row shows states on Enter, and a click on it only makes it the active row.
   */
  readonly enter?: (i: number) => void
  /**
   * Called first in every draw — a frame's, a scroll's, a resize's, a key's — which is where a view keeps anything
   * that must follow the grid's `following` in sync, such as a re-attach button's `hidden`.
   */
  readonly beforeDraw?: () => void
  /**
   * Called last in every draw that lays rows out — not one of no content, nor one against a closed grid — with the
   * window it drew, once those rows are in the DOM. Where a view paints what goes with the rows but is not in them:
   * the state diagram's gutter of arcs, which sits beside the rows in the spacer (`rowsEl`) and spans the same window.
   */
  readonly afterDraw?: (drawn: VisibleWindow) => void
  /**
   * Whether the count can fall between two draws of the same content — the state diagram's, whose sub-steps row goes
   * when the run steps into a routine that has no row of its own. The rule table's and the asm listing's counts are
   * fixed for a program, and `reset` covers a new one; a grid that says so here pays two more reads of the layout per
   * draw for the clamp a shrinking spacer causes (`draw`).
   */
  readonly shrinks?: boolean
}

/**
 * A virtualized grid of fixed-height rows with one roving active row: the TM view's rule table, and the asm
 * view's listing (Plan 7 part 5 spec, amendment 7).
 *
 * **ONE COPY OF THE PART THAT KEPT BREAKING.** The drawn window, the active row, the keys, a click that survives
 * the redraw focusing causes, and following with its clamp handling were written out in the rule table, then again
 * in the state diagram and the λ view's body; each fix to one — a lost click, a clamp read as a user's scroll —
 * had to be found again in the others. This class is the rule table's copy, moved here unchanged in behaviour, so
 * the asm listing is its second user rather than a fourth copy, and the state diagram's program level its third. The
 * λ body keeps its own: it is a tree of lines, not a grid of cells, a click on it is a token's, and its arrows fold.
 *
 * **ONE TAB STOP.** The box is the `role="grid"` element and takes the focus; each row has one `gridcell`, and the
 * active row is named by `aria-activedescendant`, so a table of 127,881 rows (`list60`'s δ-table) is not 127,881
 * tab stops. Only the rows in view are in the DOM.
 *
 * **WHAT THE VIEW STILL OWNS**: what a row says and what it marks (`GridRows.fill`), what a row does
 * (`GridOptions.activate`), the panel the box sits in, and when to draw for a new frame or link. The grid draws on
 * its own for a scroll, a resize, a key and a click.
 *
 * **A VIEW OFF THE PAGE IS STILL TOLD EVERY LINK.** `link-wiring.ts` fans each pin out to every view on the leg,
 * hidden ones included, and in Stage the view a link is made from and the view it scrolls are never on the page
 * together. So a grid is asked to scroll and to draw while its box is not rendered — off the page, or in a closed
 * panel — and `draw` does nothing that reads the layout until it is: a link's row waits for the first draw that can
 * centre it. A view that moves onto this grid inherits that guard rather than a hold it cannot honour.
 */
export class VirtualGrid {
  /** The scroll box: the `role="grid"` element, and the panel body a view hands to `createPanel`. */
  readonly el: HTMLElement
  #spacer: HTMLElement
  #rowsEl: HTMLElement
  #opts: GridOptions
  #follow = new Follow()
  /**
   * The active row (Plan 7 part 4 spec §9.2), **AN INDEX INTO THE WHOLE GRID, NOT INTO THE DRAWN WINDOW** —
   * accessibility item 3, which found a cursor designed against the rendered rows unable to move past them. The
   * keys move it by index and scroll so it is drawn; a scroll the user or following makes carries it along
   * instead, so `aria-activedescendant` always names a row that is in the DOM (`draw`), as the λ view's does.
   */
  #active = 0
  /**
   * A link's row, which the next draw against a rendered box centres in preference to `Follow`'s own target — see
   * `scrollToRow`. **A ROW, NOT A `scrollTop`**: the pixels depend on the box's height, which a box off the page
   * reports as 0. `null` when there is nothing pending.
   */
  #pendingRow: number | null = null
  /**
   * The frame a link's scroll was written against, while that scroll holds the box — see `scrollToRow`. `null`
   * when no link holds it; `{ frame: null }` is a hold for a view with no frame on display.
   */
  #hold: { frame: number | null } | null = null
  /** The box's height at the last draw — how its `scroll` handler tells a clamp from a user's scroll. */
  #drawnHeight = 0

  constructor(opts: GridOptions) {
    this.#opts = opts
    this.#rowsEl = document.createElement('div')
    this.#rowsEl.className = opts.classes.rows
    this.#spacer = document.createElement('div')
    this.#spacer.className = opts.classes.spacer
    this.#spacer.append(this.#rowsEl)
    this.el = document.createElement('div')
    this.el.className = opts.classes.box
    this.el.append(this.#spacer)
    // THE BOX IS THE GRID (spec §9.2, accessibility item 3). A `createPanel` given this box as its body makes it a
    // labelled region; setting the role afterwards keeps the panel toggle's label and makes it the grid instead.
    // The two wrappers between it and the rows are layout, so they say so to the accessibility tree.
    this.el.setAttribute('role', 'grid')
    this.el.tabIndex = 0
    this.#spacer.setAttribute('role', 'none')
    this.#rowsEl.setAttribute('role', 'rowgroup')

    this.el.addEventListener('scroll', () => {
      // A SCROLL EVENT ON A HIDDEN BOX IS NEVER USER INTENT, and reading it as such detached a following table with
      // no user gesture at all. `draw` writes `scrollTop`, and the browser delivers that write's event at the NEXT
      // rendering update rather than synchronously — so hiding the box in between lands the echo on a
      // `display: none` box, where `scrollTop` reads back 0, which is further from the expected position than any
      // tolerance. Reproduced 5/5 in Chromium on the rule table: step, close the rules panel, reopen it, and the
      // table was detached with the current row gone from the DOM. A hidden box cannot be scrolled by a person, so
      // there is nothing here to honour.
      if (!this.#opts.isOpen()) return
      // A BOX THAT CHANGED HEIGHT SINCE IT WAS DRAWN MAY HAVE HAD ITS SCROLL CLAMPED (Plan 7 part 4 spec §9.1 made
      // its height the view's), and this event can come before the resize observer's: a panel beside it that closed
      // read the layout at once, in its own toggle.
      if (this.el.clientHeight !== this.#drawnHeight) this.#follow.onResize(this.el.scrollTop)
      this.#follow.onScroll(this.el.scrollTop)
      this.draw()
    })

    // A ROW TAKES NO FOCUS ON `mousedown`; THE GRID TAKES IT WHEN THE CLICK LANDS (Plan 7 part 4 spec, amendment
    // 18). Focusing the grid draws its view, and the draw replaces every row: taken on `mousedown`, as the browser
    // would, it removed the row under the pointer before `mouseup`, and the browser fired no `click` at all — every
    // first click on the rule table from anywhere else was lost. The primary button only, so a middle button still
    // scrolls.
    this.#rowsEl.addEventListener('mousedown', (event) => {
      if (event.button === 0) event.preventDefault()
    })
    // DELEGATED FROM THE CONTAINER RATHER THAN BOUND PER ROW, because rows are recreated on every draw. The row
    // clicked becomes the active row, painted before the view's own `activate` so a view whose action draws
    // nothing — a pane with no link handler — shows it too.
    this.#rowsEl.addEventListener('click', (event) => {
      const target = event.target
      const el = target instanceof HTMLElement ? target.closest(`.${this.#opts.classes.row}`) : null
      // READ BEFORE THE FOCUS BELOW, whose draw replaces the rows. `aria-rowindex` is 1-based and counted over the
      // whole grid, so it is the row's own index whatever window it was drawn in.
      const at = el instanceof HTMLElement ? Number(el.getAttribute('aria-rowindex')) - 1 : -1
      this.el.focus({ preventScroll: true })
      const count = this.#opts.rows().count
      if (count === null || !(at >= 0 && at < count)) return
      this.#active = at
      this.draw()
      this.#opts.activate(at)
    })

    this.el.addEventListener('keydown', (e) => this.#key(e))
    // THE BOX'S HEIGHT IS ITS VIEW'S, NOT THE VIEWPORT'S (Plan 7 part 4 spec §9.1): a divider drag, a panel opening
    // beside it or a window resize changes it with no frame or scroll to redraw the window it draws.
    new ResizeObserver(() => {
      this.#follow.onResize(this.el.scrollTop)
      this.draw()
    }).observe(this.el)
  }

  /**
   * The rows' container, inside the box's spacer, for a view that draws beside its rows: the state diagram puts its
   * gutter of arcs ahead of it in the spacer, where it scrolls with them, and sets its `left` to clear it. **THE GRID
   * OWNS ITS CHILDREN AND ITS `transform`**, which every draw replaces and writes.
   */
  get rowsEl(): HTMLElement {
    return this.#rowsEl
  }

  /** The active row, an index into the whole grid (`#active`). */
  get active(): number {
    return this.#active
  }

  /**
   * Make row `i` the active row, for a view that finds it again after rebuilding its rows — the state diagram's
   * sub-steps row moves with the current instruction, and shifts every row between its old place and its new one.
   * **DOES NOT DRAW**, and the next draw keeps it only if it is on screen, as it keeps any active row.
   */
  setActive(i: number): void {
    this.#active = i
  }

  /**
   * Take the drawn rows out, and `aria-activedescendant` with them, **WHETHER OR NOT THE BOX IS ON SCREEN** — for a
   * view whose content has gone while its box was hidden. A draw against a closed grid stops before it touches the
   * rows (`draw`), so a grid of no rows drawn there keeps the last content's, hidden, with the active descendant
   * naming one of them, until a draw on screen replaces them: the state diagram's program level, which a compile
   * with no machine can empty behind the local level, a closed panel or another Stage tab. **DOES NOT DRAW.**
   */
  clear(): void {
    this.#rowsEl.replaceChildren()
    this.el.removeAttribute('aria-activedescendant')
  }

  /** Whether the grid keeps the view's `follow` row in view; a user's scroll, or a key that scrolls, stops it. */
  get following(): boolean {
    return this.#follow.following
  }

  /** Follow again, and scroll there now rather than at the next frame: a link's scroll no longer holds the box. */
  attach(): void {
    this.#follow.attach()
    this.#pendingRow = null
    this.#hold = null
    this.draw()
  }

  /**
   * New content: the first row active, following on, and the box back at the top. **DOES NOT DRAW** — the view
   * draws once it has put its own state for the new content in place.
   *
   * `onProgrammaticScroll` BEFORE THE WRITE, NOT AFTER, AND NOT OMITTED. Setting `scrollTop` fires a `scroll` event;
   * without a pending expectation `Follow` reads it as the user taking control and detaches on the spot — so the grid
   * would never follow after new content. Intermittent, too: no event fires when `scrollTop` was already 0, so it
   * would work on the first program and fail on every one after a scroll.
   */
  reset(): void {
    this.#active = 0
    // A link's row named the old content, and one recorded off the page can still be waiting for a draw.
    this.#pendingRow = null
    this.#hold = null
    this.#follow.attach()
    this.#follow.onProgrammaticScroll(0)
    this.el.scrollTop = 0
  }

  /**
   * Centre `row` at the next draw — a link's scroll — **AND HOLD IT THERE UNTIL THE RUN MOVES, WITHOUT TOUCHING
   * `Follow`'S OWN FLAG** (Plan 5 design §5.1). Following is about where the run is and a link is about a construct:
   * telling `Follow` would make a link silently re-attach a grid the user had detached, or detach one they had not.
   * But `draw` recomputes following's target whenever it follows, so writing `scrollTop` here would be reverted by
   * the very next draw; a pending target that `draw` prefers is what lets the link win.
   *
   * **WINNING ONE DRAW WAS NOT ENOUGH.** The write's own `scroll` event redraws the box a frame later, and that draw,
   * still following, scrolled straight back to the run's row: a link made while the grid followed showed its rows
   * for one frame. So the scroll holds while the frame on display is the one it was written against — through its
   * own event, a redraw of the same frame, a resize — and following takes over when the view shows another frame,
   * on `attach`, or on `reset`.
   *
   * **KEYED ON THE FRAME, NOT THE FOLLOW ROW** (amendment 21). The TM rule table follows the current state's own
   * row, and a step that loops in its state — the ordinary case in a compiled machine — leaves that row exactly
   * where it was: a hold keyed on the row instead of the frame would outlive such a step, leaving the table
   * parked on the linked block with the current rule off screen and "follow current rule" hidden because
   * following itself was never touched. A frame the view draws is a step; the run has moved the instant that
   * number changes, whether or not the row it follows moved with it.
   *
   * **THE ROW IS RECORDED, NOT ITS PIXELS, AND THE HOLD STARTS AT THE DRAW THAT WRITES THEM.** A box off the page —
   * a view Stage is not showing, which every link made in another view reaches — reports a height of 0, so a
   * `scrollTop` worked out here would be the uncentred one, and a hold keyed on the frame that view last drew would
   * outlive its own reveal: the run at rest, the frame unchanged, the box showing neither the pin nor the run. So
   * `draw` turns the row into pixels on the first draw against a rendered box, and holds against the frame that draw
   * shows: a view shown after a link made elsewhere opens on the pin, held until the run moves.
   *
   * **A CLOSED PANEL RECORDS THE ROW TOO**, for the same reason: its box is not rendered either. Refusing the row
   * there left the hold of the link before it in place, so a panel reopened with the run at rest stayed on that
   * earlier link's block — neither the new pin nor the run, following on, nothing offered to re-attach. The draw that
   * reopens the panel centres the row and holds from the frame it shows. **DOES NOT DRAW.**
   */
  scrollToRow(row: number): void {
    if (this.#opts.rows().count === null) return
    this.#pendingRow = row
  }

  /**
   * Let following have the box back: drop a link's row still waiting for a draw, and the hold a written one keeps
   * — for a pin cleared, which leaves no rows to hold the box on. Whether or not the box is rendered, so a pin
   * cleared while the view is off the page or its panel closed leaves no hold for the next draw on it to keep.
   * `Follow`'s own flag is untouched, as a link's scroll leaves it (`scrollToRow`): a grid the user detached stays
   * where they put it. **DOES NOT DRAW.**
   */
  release(): void {
    this.#pendingRow = null
    this.#hold = null
  }

  /**
   * Draw only the rows in view. Called on every frame AND on every scroll, so it must stay O(visible) rather than
   * O(rows) — 127,881 rows is the number that decides it.
   */
  draw(): void {
    this.#opts.beforeDraw?.()
    const rows = this.#opts.rows()
    const count = rows.count
    const total = (count ?? 0) * ROW_HEIGHT

    // A GRID THAT JUST LOST ROWS CLAMPS `scrollTop` ONCE ITS SCROLL RANGE SHRINKS TO MATCH, and the browser reports
    // the clamp as a `scroll` that `Follow` would read as the user's: the state diagram detached exactly so, measured
    // at 626 → 600 px as `fact(3)` stepped from `pc20` into `halt`. The clamp need not be visible in `scrollTop` yet —
    // the spacer below has not shrunk, and the diagram's gutter holds the range up until its `afterDraw` — so the
    // clamp this draw is about to cause is recorded from `total`, the content's new height, before anything shrinks.
    // The browser's own position can land a couple of pixels past this one, when a row overflows the spacer; that is
    // inside `ECHO_TOLERANCE`.
    if (this.#opts.shrinks === true) {
      const clamped = Math.max(0, total - this.el.clientHeight)
      if (this.el.scrollTop > clamped) this.#follow.onProgrammaticScroll(clamped)
    }

    if (count === null) {
      this.#rowsEl.replaceChildren()
      this.#spacer.style.height = '0px'
      this.el.removeAttribute('aria-rowcount')
      this.el.removeAttribute('aria-activedescendant')
      return
    }
    this.el.setAttribute('aria-rowcount', String(count))

    // THE SPACER CARRIES THE SCROLL RANGE, AND IT MUST STAY HONEST WHILE THE GRID IS CLOSED. Setting `scrollTop`
    // CLAMPS to the element's current scroll height, so a spacer left at the previous content's size silently
    // truncates the next write — including the one the reopen below performs. Hence both orderings here are
    // load-bearing: before the early return, and before the `scrollTop` write further down. `visibleWindow`'s
    // `totalHeight` is this same product, so it is not written twice.
    this.#spacer.style.height = `${total}px`

    // NOTHING BELOW THIS LINE MAY RUN AGAINST A CLOSED GRID, because everything below reads `clientHeight`, and a
    // non-rendered box reports 0. `targetScrollTop` against a zero viewport returns the UNCENTRED position —
    // `floor(viewportHeight / 2)` too low — and `onProgrammaticScroll` then records that as the echo to expect. The
    // `scrollTop` write is a harmless no-op; the poisoned expectation is not, because the reopen draw finds the
    // correct target already equal to the restored `scrollTop` and skips the write that would have corrected it. A
    // later real scroll landing within the tolerance of the stale value is absorbed as an echo and does not detach.
    // The rows drawn here would be wrong too — a zero viewport spans nine rows starting at 0 — and are all
    // discarded on reopen, so this returns before the work as well as before the harm.
    //
    // **AN OPEN GRID WHOSE BOX IS NOT RENDERED IS A CLOSED ONE HERE.** A view off the page in Stage keeps its
    // panels open and reports a height of 0, and it still draws — for every link (this class's doc), and for the
    // resize observer when its box leaves the page. Past this line such a draw would consume a link's row into
    // the uncentred pixels and hold it against a frame the view no longer shows (`scrollToRow`).
    const viewportHeight = this.el.clientHeight
    if (!this.#opts.isOpen() || viewportHeight === 0) return

    // THE VIEW'S FLEX LAYOUT IS THE ONLY THING BOUNDING THIS BOX (`style.css`'s panel rules for the view, Plan 7
    // part 4 spec §9.1), and `clientHeight` reports what it actually laid out rather than what the stylesheet asked
    // for. If those rules never reach the page the box grows to its full content height — measured at 271,968px
    // for 11,332 rows — the window covers every row, and every draw renders every row. The browser tier loads
    // `style.css` (`tests/browser/setup.ts`) and asserts the rule table stays bounded, so that gap fails a test
    // rather than silently costing O(rows) per frame.
    this.#drawnHeight = viewportHeight
    // A PENDING LINK ROW WINS OVER THE FOLLOW TARGET, is consumed, and then holds the box until the frame on
    // display changes — `scrollToRow`. Read and cleared together so a link recorded during THIS call is what the
    // very next draw writes, never twice: `Follow`'s expectation is armed ONCE below, by whichever branch runs,
    // rather than by the pending write and then again by a follow write that would silently revert it in the same
    // synchronous block.
    const pending = this.#pendingRow
    this.#pendingRow = null
    if (pending !== null) {
      this.#hold = { frame: rows.frame }
      // Shared with `Follow.targetScrollTop` via `centredScrollTop` — see that function's doc.
      const top = centredScrollTop(pending, ROW_HEIGHT, viewportHeight, count * ROW_HEIGHT)
      if (top !== this.el.scrollTop) {
        this.#follow.onProgrammaticScroll(top)
        this.el.scrollTop = top
      }
    } else if (this.#hold === null || this.#hold.frame !== rows.frame) {
      this.#hold = null
      if (rows.follow !== null) {
        const top = this.#follow.targetScrollTop(rows.follow, ROW_HEIGHT, viewportHeight, count * ROW_HEIGHT)
        if (top !== null && top !== this.el.scrollTop) {
          this.#follow.onProgrammaticScroll(top)
          this.el.scrollTop = top
        }
      }
    }

    const w = visibleWindow(count, ROW_HEIGHT, viewportHeight, this.el.scrollTop, OVERSCAN)
    // THE ACTIVE ROW COMES WITH THE VIEW: kept to the whole rows on screen, not the overscan, so whatever moved the
    // view — following, a link, the user — leaves `aria-activedescendant` naming a drawn row.
    const firstWhole = Math.ceil(this.el.scrollTop / ROW_HEIGHT)
    const lastWhole = Math.max(firstWhole, Math.floor((this.el.scrollTop + viewportHeight) / ROW_HEIGHT) - 1)
    // NEVER BELOW 0: with rows, every bound here is at least 0 already; with none, `count - 1` would make it -1.
    this.#active = Math.max(0, Math.min(Math.max(this.#active, firstWhole), lastWhole, count - 1))
    this.#rowsEl.style.transform = `translateY(${w.offsetY}px)`

    const els: HTMLElement[] = []
    for (let i = w.firstIndex; i <= w.lastIndex; i += 1) {
      const el = document.createElement('div')
      el.className = this.#opts.classes.row
      el.setAttribute('role', 'row')
      // 1-BASED, as `aria-rowindex` is, and counted over the whole grid: a screen reader says "row 40,213 of
      // 127,881" for a row that is one of forty in the DOM.
      el.setAttribute('aria-rowindex', String(i + 1))
      const cell = document.createElement('div')
      cell.setAttribute('role', 'gridcell')
      cell.id = `${this.#opts.idPrefix}-${i}`
      el.append(cell)
      rows.fill(i, el, cell)
      if (i === this.#active) el.classList.add('is-active')
      els.push(el)
    }
    const before = this.#opts.shrinks === true ? this.el.scrollTop : null
    this.#rowsEl.replaceChildren(...els)
    // THIS ONLY SEES A CHANGE `replaceChildren` ITSELF MAKES: `before` is read after the spacer write and the follow
    // write above, so a clamp from either of those is the prediction's to have recorded. When the old rows held the
    // range up and swapping them moves `scrollTop` on its own, this records that too, so it reads as the echo it is.
    if (before !== null && this.el.scrollTop !== before) this.#follow.onProgrammaticScroll(this.el.scrollTop)
    if (this.#active >= w.firstIndex && this.#active <= w.lastIndex) {
      this.el.setAttribute('aria-activedescendant', `${this.#opts.idPrefix}-${this.#active}`)
    } else {
      this.el.removeAttribute('aria-activedescendant')
    }
    this.#opts.afterDraw?.(w)
  }

  /**
   * The grid's keys (Plan 7 part 4 spec §9.2): ↑/↓, PgUp/PgDn and Home/End move the active row BY INDEX, and the box
   * scrolls so it is drawn; Enter does what a click does, or what the view's `enter` does when it gives one.
   *
   * **A KEY THAT SCROLLS IS THE USER TAKING CONTROL**, so following is detached before the draw below — its `scroll`
   * event comes a frame later, and a draw still following would put the view back on the followed row and carry the
   * active row with it. The λ view's keys do the same (`lambda-body.ts`).
   */
  #key(e: KeyboardEvent): void {
    const count = this.#opts.rows().count
    if (count === null || count === 0) return
    const page = Math.max(1, Math.floor(this.el.clientHeight / ROW_HEIGHT) - 1)
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
        if (this.#opts.enter === undefined) this.#opts.activate(this.#active)
        else this.#opts.enter(this.#active)
        return
      default:
        return
    }
    e.preventDefault()
    this.#active = Math.min(Math.max(next, 0), count - 1)
    const top = this.#active * ROW_HEIGHT
    const from = this.el.scrollTop
    const to = top < from ? top : Math.max(from, top + ROW_HEIGHT - this.el.clientHeight)
    if (to !== from) {
      this.#follow.detach()
      this.el.scrollTop = to
    }
    this.draw()
  }
}
