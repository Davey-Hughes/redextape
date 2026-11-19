import { followedGridPanel } from './followed-grid-panel'
import type { Labels } from './label-rows'
import type { Panel } from './panel'
import { type ListingRow, listingRows, rowsOfPcs } from './rxm-view'
import type { GridOptions, GridRows, VirtualGrid } from './virtual-grid'

/**
 * A program's listing in a panel: a row for each label and each instruction, following the instruction about to run,
 * with the marks a link and the running focus put on instructions. What an instruction's row says is the caller's
 * (`fillInstr`).
 */
export class ListingPanel {
  readonly panel: Panel
  #grid: VirtualGrid
  #cellClass: string
  #fillInstr: (pc: number, cell: HTMLElement) => void
  #source: { readonly listing: readonly string[]; readonly labels: Labels } | null = null
  #rows: readonly ListingRow[] = []
  /** Each instruction's row in `#rows`, so following and the marks find an instruction's row in one lookup. */
  #rowOf: number[] = []
  /** The instructions a link pinned, by index — marked `is-linked` (spec §6.6). */
  #linked: ReadonlySet<number> = new Set()
  /** The instructions the running focus names — marked `is-focus`, a second layer beside the pin, as the TM view's. */
  #focused: ReadonlySet<number> = new Set()
  /** The instruction about to run at the step on display, or `null` for none. */
  #next: number | null = null
  /** The step on display, or `null` with no step to show. */
  #step: number | null = null

  constructor(o: {
    readonly name: string
    readonly label: string
    readonly open: boolean
    readonly reattachText: string
    readonly classes: GridOptions['classes']
    readonly cellClass: string
    readonly idPrefix: string
    fillInstr(pc: number, cell: HTMLElement): void
    activate(pc: number): void
    onToggle(open: boolean): void
  }) {
    this.#cellClass = o.cellClass
    this.#fillInstr = (pc, cell) => o.fillInstr(pc, cell)
    const { panel, grid } = followedGridPanel({
      name: o.name,
      label: o.label,
      open: o.open,
      reattachText: o.reattachText,
      classes: o.classes,
      idPrefix: o.idPrefix,
      hasContent: () => this.#source !== null,
      rows: () => this.#listingRows(),
      activate: (i) => {
        const row = this.#rows[i]
        if (row?.kind === 'instr') o.activate(row.pc)
      },
      onToggle: (open) => o.onToggle(open),
    })
    this.panel = panel
    this.#grid = grid
  }

  /** New content, or `null` for none. **DOES NOT DRAW**: `show` does, once the caller knows what step it shows. */
  setSource(s: { readonly listing: readonly string[]; readonly labels: Labels } | null): void {
    this.#source = s
    this.#rows = s === null ? [] : listingRows(s)
    this.#rowOf = rowsOfPcs(this.#rows)
    // A new compile invalidates every instruction index a link or the running focus named.
    this.#linked = new Set()
    this.#focused = new Set()
    this.#next = null
    this.#step = null
    this.#grid.reset()
  }

  /**
   * Mark the instructions a link pinned, scrolling the listing to the first of them unless the click came from this
   * view (`scrollTo`): scrolling a list the user just clicked in moves the row out from under the pointer. The
   * scroll holds over following until the run moves and leaves following as it was — `VirtualGrid.scrollToRow`.
   * A pin with no instructions here releases an earlier link's hold instead, for `TmPane.setLink`'s reason.
   */
  setLink(pcs: readonly number[], scrollTo: boolean): void {
    this.#linked = new Set(pcs)
    if (scrollTo) {
      const first = [...pcs].sort((a, b) => a - b)[0]
      const row = first === undefined ? undefined : this.#rowOf[first]
      if (row === undefined) this.#grid.release()
      else this.#grid.scrollToRow(row)
    }
    this.#grid.draw()
  }

  /**
   * Mark the instructions the running focus names. **A PURE SETTER, CALLED BEFORE `show`**, for `TmPane.setFocus`'s
   * reason: `show` draws anyway, and drawing here too would build every row twice a frame.
   */
  setFocus(pcs: readonly number[]): void {
    this.#focused = new Set(pcs)
  }

  /** Draw the listing at a step: `next` is the instruction about to run there, and `step` the step's number. */
  show(next: number | null, step: number | null): void {
    this.#next = next
    this.#step = step
    this.#grid.draw()
  }

  /**
   * The listing's rows for one draw: a label row names its label; an instruction row is `fillInstr`'s. The
   * instruction about to run is `.is-next` and says "runs next" in words, as generated content — the not-colour cue
   * the TM view's "fires next" has (spec §6.2) — and it is the row following keeps in view.
   */
  #listingRows(): GridRows {
    if (this.#source === null) return { count: null, follow: null, frame: null, fill: () => {} }
    const nextRow = this.#next === null ? null : (this.#rowOf[this.#next] ?? null)
    return {
      count: this.#rows.length,
      follow: nextRow,
      // THE STEP THIS DRAW SHOWS, NOT WHETHER THE FOLLOWED ROW MOVED — `TmPane.#tableRows`'s reason, one leg over:
      // the row above is the instruction the machine is ABOUT to run, and a jump to itself leaves that row
      // unchanged, so a hold keyed on `follow` alone would never release (Plan 7 part 5 spec amendment 21).
      frame: this.#step,
      fill: (i, el, cell) => {
        const row = this.#rows[i]
        if (row === undefined) return
        cell.className = this.#cellClass
        if (row.kind === 'label') {
          el.classList.add('is-label')
          cell.textContent = `${row.name}:`
          return
        }
        this.#fillInstr(row.pc, cell)
        if (i === nextRow) {
          el.classList.add('is-next')
          el.setAttribute('aria-current', 'step')
          cell.dataset.marks = 'runs next'
        }
        if (this.#linked.has(row.pc)) el.classList.add('is-linked')
        if (this.#focused.has(row.pc)) el.classList.add('is-focus')
      },
    }
  }
}
