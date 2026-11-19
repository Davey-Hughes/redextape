import type { ControlState } from './controls'
import type { EditablePane } from './editor-custody'
import { ListingPanel } from './listing-panel'
import {
  callStackPanel,
  type HeapView,
  heapPanel,
  type MachinePanel,
  type StackView,
  type ValuesView,
  valuesPanel,
} from './machine-panels'
import { MachineViewChrome } from './machine-view-chrome'
import type { PaneEvents } from './pane-chrome'
import { PanelStack, type Shares } from './panel-stack'
import { endedLine } from './results'
import { instrParts, rxmHeap, rxmStack, rxmValues } from './rxm-view'
import type { RxmScratchReading } from './sessions'
import type { RxmProgram, RxmState } from './types'

/** Mints each view's listing a prefix for its cells' ids, which `aria-activedescendant` names. */
let listingsMinted = 0

/** Which panels a view has, by the name each is stored under in the workspace (`workspace.ts`'s `Panels`). */
export type RxmPanels = {
  readonly listing?: boolean
  readonly registers?: boolean
  readonly stack?: boolean
  readonly heap?: boolean
  readonly outline?: boolean
}

/**
 * The rxm view (Plan 7 part 5 spec §6): the program's listing, and the machine's registers, call stack and heap as it
 * stands at the displayed step.
 *
 * **A PAGE OF PANELS SHARING THE VIEW'S HEIGHT, AS THE TM VIEW'S ARE** (spec §6.1; `style.css`'s `.rxm-pane` rules):
 * the listing two shares, the registers and call stack side by side in one share, the heap one. Each panel's toggle and
 * actions sit in its own header, not the view's (amendment 9), and its open state is saved per view.
 *
 * **THE LISTING IS A `VirtualGrid`**, the rule table's (amendment 7): one tab stop, a roving active row, a click that
 * survives the redraw focusing causes, and following the instruction about to run until the user scrolls away.
 *
 * **THE PANELS ARE DRAWN WHOLE, NOT VIRTUALIZED.** Each shows a window core already bounded (`RxmState`'s: 64 locals, 16
 * arguments, 8 frames, 16 cells and 16 boxes, set in `protocol.ts`), so a frame's panels are at most a few hundred short
 * lines however long the run.
 *
 * **ON A COPY IT HOLDS THE COPY'S EDITOR, AS THE TM VIEW HOLDS A TM COPY'S** (spec amendment 28): the text panel first,
 * then the copy's value, the panels above, and the outline — its labels — last. The listing stays: it is the only
 * place the instruction about to run is marked, since a copy's editor marks no running line (spec §10).
 *
 * `RxmPane` SATISFIES `PaneView<RxmState>`, as the λ and TM views satisfy theirs, with no `implements PaneView`
 * clause — `sessions.ts`'s `PaneView` doc says why the parameterisation is the check. It implements `EditablePane`,
 * as `TmPane` does, so custody can mount a copy's editor on it and destroy the one it leaves; the members it inherits
 * from `MachineViewChrome` hand off to `copy`, the `CopyEditor` the two views share.
 */
export class RxmPane extends MachineViewChrome implements EditablePane {
  #body: HTMLElement
  #program: RxmProgram | null = null
  #frame: RxmState | null = null
  #listing: ListingPanel
  #values: MachinePanel<ValuesView>
  #stack: MachinePanel<StackView>
  #heap: MachinePanel<HeapView>
  /**
   * A copy's value, `value: 42`, from the reading its build and any `[continue]` carried; empty on a view of the
   * program, whose value the readout says. A `status` region, like `TmPane.#value`, though it changes per build, not
   * per step.
   *
   * **`setDetached` DOES NOT CLEAR IT, WHERE `TmPane`'S CLEARS ITS SCRATCH READING AS A SECOND LINE.** Every route
   * that moves a view onto a session but one seeds it through `seedRxm`, which sets the value that session has — none,
   * for the program. The one is a fork, which moves a view of the program, whose value line is already empty, onto a
   * copy that has built nothing yet, and the copy's first build sets its value (`replies.ts`'s `rxm-scratch-compiled`
   * arm). So a clear there would repeat one no route can skip, and nothing could tell whether it ran.
   */
  #value: HTMLElement

  /**
   * `panels` is the view's stored panel state, read once here; each panel reports every later toggle through
   * `on.panel`. Every panel opens by default.
   */
  constructor(host: HTMLElement, on: PaneEvents, panels: RxmPanels = {}, sizes: Shares = {}) {
    // THE COPY'S EDITOR, TEXT PANEL AND OUTLINE (`copy-editor.ts`). The outline is closed by default, as the TM view's
    // is. No `editorUnmounted`: `#value`'s doc says why the copy's value is not cleared with the editor.
    super(on, { what: 'the whole program', noun: 'instructions', outlineOpen: panels.outline ?? false })
    this.#value = document.createElement('div')
    this.#value.className = 'rxm-value'
    this.#value.setAttribute('role', 'status')

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

    // THE REGISTERS AND THE CALL STACK SHARE ONE ROW, side by side, and stack when the view is too narrow for both
    // (spec §6.1) — a wrapping flex row, `style.css`'s `.rxm-machine`.
    const machine = document.createElement('div')
    machine.className = 'rxm-machine'
    machine.append(this.#values.panel.el, this.#stack.panel.el)

    // THE TEXT PANEL FIRST, THE OUTLINE LAST — the TM view's order under its status line (spec amendment 28), a line
    // this view does not have. On a view of the program both start hidden and take no room, so this order is
    // invisible until a copy's editor mounts.
    this.#body = document.createElement('div')
    this.#body.className = 'rxm-pane'
    this.#body.append(
      this.copy.textPanel,
      this.#value,
      listingPanel.el,
      machine,
      this.#heap.panel.el,
      this.copy.outline,
    )
    this.mount(host, this.#body)
    // THE REGIONS THAT SHARE THE VIEW'S HEIGHT (the view layouts spec §11.1), top to bottom. The registers and the
    // call stack are one region, the row they share: no boundary parts the two (they wrap one under the other in a
    // narrow view).
    // IT KEEPS ITSELF: its listeners are on the regions and their headers, and nothing here reads it again.
    new PanelStack(
      [
        this.textRegion(),
        {
          name: 'listing',
          label: 'listing',
          el: listingPanel.el,
          share: 2,
          panels: [listingPanel],
          bodies: () => [listingPanel.body],
        },
        {
          name: 'machine',
          label: 'registers and call stack',
          el: machine,
          share: 1,
          panels: [this.#values.panel, this.#stack.panel],
          bodies: () => [this.#values.panel, this.#stack.panel].filter((p) => p.isOpen()).map((p) => p.body),
        },
        {
          name: 'heap',
          label: 'heap',
          el: this.#heap.panel.el,
          share: 1,
          panels: [this.#heap.panel],
          bodies: () => [this.#heap.panel.body],
        },
        this.outlineRegion(),
      ],
      sizes,
      (next) => on.panelSizes?.(next),
    )
  }

  /**
   * Set once per compile: the listing and its labels, which do not change as the run moves. `null` for a session with
   * no rxm leg, which clears the view.
   */
  setProgram(p: RxmProgram | null): void {
    this.#program = p
    this.#listing.setSource(p)
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

  /** An rxm copy's value, or `null` to clear it — set by its build, a `[continue]`, and a seed from what its session kept. */
  setScratch(reading: RxmScratchReading | null): void {
    this.#value.textContent = reading === null ? '' : endedLine(reading.value)
  }

  render(frame: RxmState | null, controls: ControlState): void {
    this.#frame = frame
    this.steps.update(controls)
    this.#draw()
  }

  #draw(): void {
    const frame = this.#frame
    const program = this.#program
    this.#listing.show(frame?.next ?? null, frame?.step ?? null)
    this.#values.show(frame === null ? null : rxmValues(frame))
    this.#stack.show(frame === null || program === null ? null : rxmStack(frame, program))
    this.#heap.show(frame === null ? null : rxmHeap(frame))
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
