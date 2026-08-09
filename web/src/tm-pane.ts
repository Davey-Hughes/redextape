import type { ControlState } from './controls'
import { n } from './format'
import { controlStrip, type PaneEvents } from './pane-chrome'
import { Follow, highlight, ROW_HEIGHT, StateIndex } from './state-table'
import { tapeRows } from './tape'
import type { TmProgram, TmState } from './types'
import { visibleWindow } from './virtual-list'

export { ROW_HEIGHT } from './state-table'

/** Rows rendered beyond the viewport on each side, so a fast scroll does not show blank space. */
export const OVERSCAN = 4

/**
 * The TM pane: five tape rows, a status line, and the δ function as a virtualized table.
 *
 * FIVE ROWS, NOT ONE. §6.1's mockup shows a single tape; the lowering emits `TAPES = 5` and showing
 * them together is the point — you cannot watch STACK move while REG is read otherwise.
 *
 * THE TABLE IS VIRTUALIZED BECAUSE `list60` IS 127,881 ROWS (design §3.1). The `[1, 2]` fixture's 455
 * rows, which sized this feature until it was measured, is 0.4% of that.
 */
export class TmPane {
  #status: HTMLElement
  #tapes: HTMLElement
  #strip: ReturnType<typeof controlStrip>
  #program: TmProgram | null = null
  #names: string[] = []
  #frame: TmState | null = null

  #tableHost: HTMLElement
  #spacer: HTMLElement
  #rows: HTMLElement
  #toggle: HTMLButtonElement
  #reattach: HTMLButtonElement
  #index: StateIndex | null = null
  #follow = new Follow()
  #open = true

  constructor(host: HTMLElement, on: PaneEvents) {
    const title = document.createElement('h2')
    title.textContent = 'turing machine'
    this.#status = document.createElement('div')
    this.#status.className = 'tm-status'
    this.#tapes = document.createElement('div')
    this.#tapes.className = 'tapes'
    this.#strip = controlStrip(on)

    this.#toggle = document.createElement('button')
    this.#toggle.type = 'button'
    this.#toggle.className = 'table-toggle'
    this.#toggle.textContent = 'hide δ'
    this.#toggle.addEventListener('click', () => {
      this.#open = !this.#open
      this.#toggle.textContent = this.#open ? 'hide δ' : 'show δ'
      this.#tableHost.hidden = !this.#open
      // REDRAW IN BOTH DIRECTIONS, and the closing one is not symmetry for its own sake. `#drawTable`
      // is where `#reattach.hidden` is maintained, so skipping it on the way down left a live "follow"
      // button over a table that is not on screen — the idiom's own rule broken, and the `|| !this.#open`
      // term written for it could never fire because the only place that reads it did not run.
      // Reopening matters for a different reason: a hidden box has `clientHeight` 0, so any step taken
      // while the table was closed computed its scroll target against a zero-height viewport and left
      // the head parked off centre until some later step happened to recentre it.
      this.#drawTable()
    })

    // ADDED AND REMOVED, NEVER DISABLED — same idiom `pane-chrome.ts` states for the continue button.
    // A reattach only does something while the table is detached, so it exists only then; `#drawTable`
    // keeps `hidden` in sync every frame and every scroll, the one place both happen.
    this.#reattach = document.createElement('button')
    this.#reattach.type = 'button'
    this.#reattach.className = 'table-reattach'
    this.#reattach.textContent = 'follow'
    this.#reattach.hidden = true
    this.#reattach.addEventListener('click', () => {
      this.#follow.attach()
      // Redraw now, not at the next step — otherwise the current row stays wherever the manual scroll
      // left it until the machine happens to advance.
      this.#drawTable()
    })

    this.#rows = document.createElement('div')
    this.#rows.className = 'state-rows'
    this.#spacer = document.createElement('div')
    this.#spacer.className = 'state-spacer'
    this.#spacer.append(this.#rows)
    this.#tableHost = document.createElement('div')
    this.#tableHost.className = 'state-table'
    this.#tableHost.append(this.#spacer)
    this.#tableHost.addEventListener('scroll', () => {
      // A SCROLL EVENT ON A HIDDEN TABLE IS NEVER USER INTENT, and reading it as such detached a
      // following table with no user gesture at all. `#drawTable` writes `scrollTop`, and the browser
      // delivers that write's event at the NEXT rendering update rather than synchronously — so
      // hiding the table in between lands the echo on a `display: none` box, where `scrollTop` reads
      // back 0, which is further from the expected position than any tolerance. Reproduced 5/5 in
      // Chromium: step, hide δ, show δ, and the table is detached with the current row gone from the
      // DOM. A hidden box cannot be scrolled by a person, so there is nothing here to honour.
      if (!this.#open) return
      this.#follow.onScroll(this.#tableHost.scrollTop)
      this.#drawTable()
    })

    host.replaceChildren(
      title,
      this.#status,
      this.#tapes,
      this.#toggle,
      this.#reattach,
      this.#tableHost,
      this.#strip.el,
    )
  }

  /**
   * Set once per compile. `TmProgram` is ~123 states for `let x = 40; x + 2` and does not change as
   * the cursor moves, which is what the `TmProgram`/`TmState` split exists for.
   */
  setProgram(p: TmProgram | null, names: string[]): void {
    this.#program = p
    this.#names = names
    this.#index = p === null ? null : new StateIndex(p)
    this.#follow.attach()
    // `onProgrammaticScroll` BEFORE the write, not after, and not omitted. Setting `scrollTop` fires a
    // `scroll` event; without a pending expectation `Follow` reads it as the user taking control and
    // detaches on the spot — so the table would never follow after a compile. Intermittent, too: no
    // event fires when `scrollTop` was already 0, so it would work on the first program and fail on
    // every one after a scroll. Found by Task 5's re-review before this code was written.
    this.#follow.onProgrammaticScroll(0)
    this.#tableHost.scrollTop = 0
    this.#frame = null
    this.#drawTable()
  }

  render(frame: TmState | null, controls: ControlState): void {
    this.#frame = frame
    this.#strip.update(controls)
    if (frame === null || this.#program === null) {
      this.#status.textContent = ''
      this.#tapes.replaceChildren()
      this.#drawTable()
      return
    }

    // A `StateId` past the end yields no name rather than an index nobody can read — the same
    // no-fallback rule `TmState::source_node` follows one layer in.
    const name = this.#program.states[frame.state]?.name ?? `state ${frame.state}`
    this.#status.textContent = `${name} · width ${n(this.#program.width)}`

    this.#tapes.replaceChildren(
      ...tapeRows(frame, this.#names).map((row) => {
        const el = document.createElement('div')
        el.className = 'tape'
        const label = document.createElement('span')
        label.className = 'tape-label'
        label.textContent = row.label
        const cells = document.createElement('span')
        cells.className = 'cells'
        cells.append(
          ...row.cells.map((c, i) => {
            const cell = document.createElement('span')
            cell.className = i === row.headIndex && row.headInWindow ? 'cell head' : 'cell'
            cell.textContent = c
            return cell
          }),
        )
        el.append(label, cells)
        return el
      }),
    )

    this.#drawTable()
  }

  /**
   * Draw only the rows in view. Called on every frame AND on every scroll, so it must stay O(visible)
   * rather than O(rowCount) — 127,881 rows is the number that decides it.
   */
  #drawTable(): void {
    // Kept in sync HERE, not in the click handlers, because this is the one place that runs on every
    // frame AND every scroll — the two ways `#follow.following` can change. Hidden with no program at
    // all (reattaching means nothing against an empty table) and while the table is closed, where the
    // button would offer to reposition something nobody can see — the same idiom the control itself
    // follows, which exists so a control is present only when it does something.
    this.#reattach.hidden = this.#index === null || this.#follow.following || !this.#open

    if (this.#index === null) {
      this.#rows.replaceChildren()
      this.#spacer.style.height = '0px'
      return
    }

    // THE SPACER CARRIES THE SCROLL RANGE, AND IT MUST STAY HONEST WHILE THE TABLE IS CLOSED. Setting
    // `scrollTop` CLAMPS to the element's current scroll height, so a spacer left at a previous
    // program's size silently truncates the next write — including the one the reopen below performs.
    // Hence both orderings here are load-bearing: before the early return, and before the `scrollTop`
    // write further down. `visibleWindow`'s `totalHeight` is this same product, so it is not written
    // twice.
    this.#spacer.style.height = `${this.#index.rowCount * ROW_HEIGHT}px`

    // NOTHING BELOW THIS LINE MAY RUN AGAINST A CLOSED TABLE, because everything below reads
    // `clientHeight`, and a non-rendered box reports 0. `targetScrollTop` against a zero viewport
    // returns the UNCENTRED position — `floor(viewportHeight / 2)` too low — and `onProgrammaticScroll`
    // then records that as the echo to expect. The `scrollTop` write is a harmless no-op; the poisoned
    // expectation is not, because the reopen draw finds the correct target already equal to the
    // restored `scrollTop` and skips the write that would have corrected it. A later real scroll
    // landing within the tolerance of the stale value is absorbed as an echo and does not detach.
    // The rows drawn here would be wrong too — a zero viewport spans nine rows starting at 0 — and are
    // all discarded on reopen, so this returns before the work as well as before the harm.
    if (!this.#open) return

    // `.state-table`'s `max-height: 40vh` is the ONLY thing bounding this box, and `clientHeight`
    // reports what it actually laid out rather than what the stylesheet asked for. If the rule never
    // reaches the page the box grows to its full content height — measured at 271,968px for 11,332
    // rows — `spanned` covers the whole table, and every draw renders every row. The browser tier
    // loads `style.css` (`tests/browser/setup.ts`) and asserts this box stays bounded, so that gap
    // fails a test rather than silently costing O(rowCount) per frame.
    const viewportHeight = this.#tableHost.clientHeight
    const marks = highlight(this.#index, this.#frame)
    if (marks !== null) {
      const top = this.#follow.targetScrollTop(
        marks.stateRow,
        ROW_HEIGHT,
        viewportHeight,
        this.#index.rowCount * ROW_HEIGHT,
      )
      if (top !== null && top !== this.#tableHost.scrollTop) {
        this.#follow.onProgrammaticScroll(top)
        this.#tableHost.scrollTop = top
      }
    }

    const w = visibleWindow(this.#index.rowCount, ROW_HEIGHT, viewportHeight, this.#tableHost.scrollTop, OVERSCAN)
    this.#rows.style.transform = `translateY(${w.offsetY}px)`

    const els: HTMLElement[] = []
    for (let i = w.firstIndex; i <= w.lastIndex; i += 1) {
      const row = this.#index.row(i)
      if (row === null) continue
      const el = document.createElement('div')
      el.className = 'state-row'
      if (row.kind === 'state') {
        el.classList.add('is-state')
        if (row.accept) el.classList.add('is-accept')
        el.textContent = row.name
      } else {
        el.classList.add('is-rule')
        const cell = (v: string | null) => v ?? '*'
        el.textContent = `[${row.read.map(cell).join(' ')}] → [${row.write.map(cell).join(' ')}] ${row.moves.join(' ')} → ${
          this.#program?.states[row.next]?.name ?? row.next
        }`
      }
      if (marks !== null && i === marks.stateRow) el.classList.add('is-current')
      if (marks !== null && i === marks.ruleRow) el.classList.add('is-firing')
      els.push(el)
    }
    this.#rows.replaceChildren(...els)
  }
}
