import type { ControlState } from './controls'
import { ListingPanel } from './listing-panel'
import {
  callStackPanel,
  type HeapView,
  heapPanel,
  type MachinePanel,
  type RoomPanel,
  type StackView,
  type ValuesView,
  valuesPanel,
} from './machine-panels'
import { MachineRow } from './machine-row'
import { MachineViewChrome } from './machine-view-chrome'
import type { PaneEvents } from './pane-chrome'
import { PanelStack, type Shares } from './panel-stack'
import { instrParts, rxmHeap, rxmStack, rxmValues } from './rxm-view'
import type { RxmProgram, RxmState } from './types'

/** Mints each view's listing a prefix for its cells' ids, which `aria-activedescendant` names. */
let listingsMinted = 0

/** Which panels a view has, by the name each is stored under in the workspace (`workspace.ts`'s `Panels`). */
export type RxmPanels = {
  readonly listing?: boolean
  readonly registers?: boolean
  readonly stack?: boolean
  readonly heap?: boolean
}

/**
 * The rxm view (Plan 7 part 5 spec §6): the program's listing, and the machine's registers, call stack and heap as it
 * stands at the displayed step.
 *
 * **A PAGE OF PANELS SHARING THE VIEW'S HEIGHT, AS THE TM VIEW'S ARE** (spec §6.1; `style.css`'s `.rxm-pane` rules):
 * the listing two shares, the row under it one, the heap in that row or in a region of its own (`machine-row.ts`). Each
 * panel's toggle and actions sit in its own header, not the view's (amendment 9), and its open state is saved per view.
 *
 * **THE LISTING IS A `VirtualGrid`**, the rule table's (amendment 7): one tab stop, a roving active row, a click that
 * survives the redraw focusing causes, and following the instruction about to run until the user scrolls away.
 *
 * **THE PANELS ARE DRAWN WHOLE, NOT VIRTUALIZED.** Each shows a window core already bounded (`RxmState`'s: 64 locals, 16
 * arguments, 8 frames, 16 cells and 16 boxes, set in `protocol.ts`), so a frame's panels are at most a few hundred short
 * lines however long the run.
 *
 * `RxmPane` SATISFIES `PaneView<RxmState>`, as the λ and TM views satisfy theirs, with no `implements PaneView`
 * clause — `sessions.ts`'s `PaneView` doc says why the parameterisation is the check.
 */
export class RxmPane extends MachineViewChrome {
  #body: HTMLElement
  #program: RxmProgram | null = null
  #frame: RxmState | null = null
  /** Whether `#frame` is the run's result, which the registers and the heap mark: `setResult`. */
  #result = false
  #listing: ListingPanel
  #values: RoomPanel<ValuesView>
  #stack: MachinePanel<StackView>
  #heap: RoomPanel<HeapView>

  /**
   * `panels` is the view's stored panel state, read once here; each panel reports every later toggle through
   * `on.panel`. Every panel opens by default.
   */
  constructor(host: HTMLElement, on: PaneEvents, panels: RxmPanels = {}, sizes: Shares = {}) {
    super(on)

    // THE LISTING (spec §6.2). A row links the construct its instruction was lowered from (spec §6.6); a label row names
    // no instruction and links nothing.
    this.#listing = new ListingPanel({
      name: 'listing',
      label: 'listing',
      open: panels.listing ?? true,
      reattachText: 'follow current instruction',
      classes: { box: 'rxm-listing', spacer: 'rxm-spacer', rows: 'rxm-rows', row: 'rxm-row' },
      cellClass: 'rxm-cell',
      idPrefix: `rxm-grid-${listingsMinted++}`,
      fillInstr: (pc, cell) => this.#fillInstr(pc, cell),
      activate: (pc) => on.linkInstr?.(pc),
      onToggle: (open) => on.panel?.('listing', open),
    })
    const listingPanel = this.#listing.panel

    this.#values = valuesPanel({
      name: 'registers',
      label: 'registers',
      open: panels.registers ?? true,
      onToggle: (open) => on.panel?.('registers', open),
    })
    this.#stack = callStackPanel({
      name: 'stack',
      label: 'call stack',
      open: panels.stack ?? true,
      onToggle: (open) => on.panel?.('stack', open),
    })
    this.#heap = heapPanel({
      name: 'heap',
      label: 'heap',
      open: panels.heap ?? true,
      onToggle: (open) => on.panel?.('heap', open),
    })

    // THE REGISTERS, THE CALL STACK AND THE HEAP, laid out by the view's width (`machine-row.ts`). 18REM EACH (the
    // machine panels row design §5.1): a frame lists its caller's saved locals and a heap line every register that
    // points at its cell, and a narrower column cuts each short.
    const row = new MachineRow({
      values: this.#values.panel,
      stack: this.#stack.panel,
      heap: this.#heap.panel,
      columns: [18, 18, 18],
    })

    this.#body = document.createElement('div')
    this.#body.className = 'rxm-pane'
    this.#body.append(listingPanel.el, row.el, row.stackRegion, row.heapRegion)
    this.mount(host, this.#body)
    // THE REGIONS THAT SHARE THE VIEW'S HEIGHT (the view layouts spec §11.1), top to bottom. The row and the call
    // stack's and the heap's regions are three, whichever of them each panel is in now (`machine-row.ts`).
    // IT KEEPS ITSELF: its listeners are on the regions and their headers, and only the row reads it again.
    const stack = new PanelStack(
      [
        {
          name: 'listing',
          label: 'listing',
          el: listingPanel.el,
          share: 2,
          panels: [listingPanel],
          bodies: () => [listingPanel.body],
        },
        ...row.regions,
      ],
      sizes,
      (next) => on.panelSizes?.(next),
    )
    row.follow(host, stack)
  }

  /**
   * Set once per compile: the listing and its labels, which do not change as the run moves. `null` for a session with
   * no rxm leg, which clears the view. The registers and the heap forget the room their texts needed, which was another
   * run's.
   */
  setProgram(p: RxmProgram | null): void {
    this.#program = p
    this.#listing.setSource(p)
    this.#values.forget()
    this.#heap.forget()
    this.#frame = null
    this.#draw()
  }

  /** Mark the instructions a link pinned: `ListingPanel.setLink`. */
  setLink(instrs: readonly number[], scrollTo: boolean): void {
    this.#listing.setLink(instrs, scrollTo)
  }

  /** Mark the instructions the running focus names, for the next `render` to draw: `ListingPanel.setFocus`. */
  setFocus(instrs: readonly number[]): void {
    this.#listing.setFocus(instrs)
  }

  /**
   * Whether the frame the next `render` draws is the run's result, which the registers mark (`draw.ts`, by
   * `result-mark.ts`). **A PURE SETTER**, set before that `render` as `setFocus` is, so the frame is drawn once.
   */
  setResult(on: boolean): void {
    this.#result = on
  }

  render(frame: RxmState | null, controls: ControlState): void {
    this.#frame = frame
    this.steps.update(controls)
    this.#draw()
  }

  #draw(): void {
    const frame = this.#frame
    const program = this.#program
    // ONCE THE RUN HAS ENDED `next` IS NULL, and the listing follows `pc`, unmarked, so the end shows where the run
    // stopped and calls nothing next. A fetch past the end of the program leaves `pc` on a row the listing does not
    // have (`RxmCursor::pc`), so that end follows nothing.
    this.#listing.show(frame?.next ?? null, frame?.step ?? null, {
      follow: frame === null ? null : (frame.next ?? frame.pc),
    })
    this.#values.show(frame === null ? null : rxmValues(frame, this.#result))
    this.#stack.show(frame === null || program === null ? null : rxmStack(frame, program))
    this.#heap.show(frame === null ? null : rxmHeap(frame, this.#result))
  }

  /** An instruction's row in the listing, which reads `pc5  jz  r1, else2`. */
  #fillInstr(at: number, cell: HTMLElement): void {
    const { mnemonic, operands } = instrParts(this.#program?.listing[at] ?? '')
    const pc = document.createElement('span')
    pc.className = 'rxm-pc'
    pc.textContent = `pc${at}`
    const m = document.createElement('b')
    m.className = 'rxm-mnemonic'
    m.textContent = mnemonic
    cell.append(pc, m)
    if (operands !== '') cell.append(` ${operands}`)
  }
}
