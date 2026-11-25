import {
  CLIF_COPY,
  type ClifLayout,
  type ClifNotice,
  type ClifRows,
  clifHeap,
  clifLeads,
  clifNotice,
  clifRows,
  clifStack,
  clifValues,
  pcColumn,
} from './clif-view'
import type { ControlState } from './controls'
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
import { MachineRow } from './machine-row'
import { MachineViewChrome } from './machine-view-chrome'
import type { PaneEvents } from './pane-chrome'
import { PanelStack, type Shares } from './panel-stack'
import type { ClifCompiled } from './protocol'
import type { PaneView } from './sessions'
import type { ClifListing, ClifRow, ClifRowKind, ClifState } from './types'
import { radioGroup } from './view-header'
import { type ClifDisplay, DEFAULT_CLIF_DISPLAY } from './workspace'

/** Mints each view's listing a prefix for its cells' ids, which `aria-activedescendant` names. */
let listingsMinted = 0

/** Which panels a CLIF view has, by the name each is stored under in the workspace (`panes.ts`'s `LEG_PANELS`). */
export type ClifPanels = Partial<Record<'listing' | 'values' | 'stack' | 'heap', boolean>>

/** The class a row that shows no instruction carries for its kind. */
const LABEL_CLASS: { readonly [K in Exclude<ClifRowKind, 'Inst'>]: string } = {
  Function: 'is-function',
  Decl: 'is-decl',
  Blank: 'is-blank',
  Block: 'is-block',
  Alias: 'is-alias',
  Close: 'is-close',
}

/**
 * The CLIF view (CLIF view design §4): Cranelift's IR for the program, built from the rxm program, and the run's frame
 * at the displayed step. **THE RXM VIEW'S PARTS, WITH ITS OWN ROWS** (`clif-view.ts`): its listing's labels are the
 * rows that show no instruction, as Cranelift prints them, and its panels share the view's height as the rxm view's do.
 */
export class ClifPane extends MachineViewChrome implements PaneView<ClifState> {
  #on: PaneEvents
  #program: ClifCompiled | null = null
  /** The listing `#program` carries, its rows and the spaces before each row's text in each layout; `null` for none. */
  #shown: {
    readonly listing: ClifListing
    readonly rows: ClifRows
    readonly leads: { readonly [L in ClifLayout]: readonly number[] }
  } | null = null
  /** How the listing is laid out: the view's own choice, as a λ view's *expand all* is. */
  #layout: ClifLayout
  #frame: ClifState | null = null
  /** Whether `#frame` is the run's result, which the values mark: `setResult`. */
  #result = false
  #listing: ListingPanel
  #values: MachinePanel<ValuesView>
  #stack: MachinePanel<StackView>
  #heap: MachinePanel<HeapView>
  /**
   * What the listing says instead of the listing: on the page while `clifNotice` gives one, and a `status` region, so
   * a change of what it says is read out. **ONE ELEMENT, FILLED AGAIN ONLY WHEN THE WORDS CHANGE** (`#said`), since
   * every frame draws it and a region filled again says itself again.
   */
  #notice: HTMLElement
  /** What `#notice` says, or `null` while it is off the page. */
  #said: string | null = null
  /** The listing switch on the view's bar, or `null` for a view built without `clifListing`. */
  #switch: ReturnType<typeof listingSwitch> | null

  /**
   * `panels`, `sizes` and `display` are the view's stored panel state, shares and display settings, read once here; a
   * change of layout is reported through `on.clifDisplay`.
   */
  constructor(
    host: HTMLElement,
    on: PaneEvents,
    panels: ClifPanels = {},
    sizes: Shares = {},
    display: ClifDisplay = DEFAULT_CLIF_DISPLAY,
  ) {
    super(on)
    this.#on = on
    this.#layout = display.layout
    this.#notice = document.createElement('p')
    this.#notice.className = 'clif-notice'
    this.#notice.setAttribute('role', 'status')
    // THE SWITCH GOES BEFORE `⋯`, AS THE TM VIEW'S WIDTH BOX DOES: the program's setting this view shows, ahead of the
    // view's own actions.
    this.#switch = on.clifListing === undefined ? null : listingSwitch(on.clifListing)
    if (this.#switch !== null) this.header.actions.prepend(this.#switch.el)
    // IN THE VIEW'S `⋯` MENU, AS A λ VIEW'S *EXPAND ALL* IS: how this view shows the listing, not what it shows.
    this.menu.addCheck('clif-compact', 'compact', {
      on: () => this.#layout === 'compact',
      set: (on) => this.#setLayout(on ? 'compact' : 'exact'),
    })

    // A ROW WITH A SRCLOC LINKS THE RXM INSTRUCTION IT WAS LOWERED FROM (CLIF view design §4, *Links*); one with none
    // links nothing.
    this.#listing = new ListingPanel({
      name: 'listing',
      label: 'listing',
      open: panels.listing ?? true,
      reattachText: 'follow current instruction',
      classes: { box: 'clif-listing', spacer: 'clif-spacer', rows: 'clif-rows', row: 'clif-row' },
      cellClass: 'clif-cell',
      idPrefix: `clif-grid-${listingsMinted++}`,
      fillInstr: (ordinal, cell) => this.#fillInstr(ordinal, cell),
      fillLabel: (name, cell) => this.#fillLabel(name, cell),
      activate: (ordinal) => on.linkInstr?.(this.#instRow(ordinal)?.pc ?? null),
      onToggle: (open) => on.panel?.('listing', open),
    })
    const listingPanel = this.#listing.panel

    this.#values = valuesPanel({
      name: 'values',
      label: 'values',
      open: panels.values ?? true,
      onToggle: (open) => on.panel?.('values', open),
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

    // THE VALUES, THE CALL STACK AND THE HEAP, laid out by the view's width as the rxm view's are (`machine-row.ts`).
    // THE VALUES ONE PART, THE CALL STACK AND THE HEAP TWO EACH (the machine panels row design §5.1): a value is short
    // and a header's count is not, so the two headers that carry a count have the room to hold it whole.
    const row = new MachineRow({
      values: this.#values.panel,
      stack: this.#stack.panel,
      heap: this.#heap.panel,
      columns: [7.375, 14.75, 14.75],
    })

    const body = document.createElement('div')
    body.className = 'clif-pane'
    body.append(listingPanel.el, row.el, row.stackRegion, row.heapRegion)
    this.mount(host, body)
    // IT KEEPS ITSELF, as `RxmPane`'s does: its listeners are on the regions and their headers, and only the row reads
    // it again.
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
    this.#draw()
  }

  /**
   * The program's CLIF: its listing, or why it has none; `null` while none has come, which the view says is loading.
   * Its rows do not change as the run moves.
   */
  setProgram(p: ClifCompiled | null): void {
    this.#program = p
    this.#shown =
      p !== null && 'listing' in p
        ? {
            listing: p.listing,
            rows: clifRows(p.listing),
            leads: { compact: clifLeads(p.listing, 'compact'), exact: clifLeads(p.listing, 'exact') },
          }
        : null
    this.#listing.setSource(this.#shown?.rows.source ?? null)
    this.#frame = null
    this.#draw()
  }

  /** Mark every Inst row whose srcloc is one of the rxm `pcs` a link pinned: `ListingPanel.setLink`. */
  setLink(pcs: readonly number[], scrollTo: boolean): void {
    this.#listing.setLink(this.#ordinalsOf(pcs), scrollTo)
  }

  /** Mark every Inst row whose srcloc is one of the rxm `pcs` the running focus names: `ListingPanel.setFocus`. */
  setFocus(pcs: readonly number[]): void {
    this.#listing.setFocus(this.#ordinalsOf(pcs))
  }

  /**
   * Whether the frame the next `render` draws is the run's result, which the values mark (`draw.ts`, by
   * `result-mark.ts`). **A PURE SETTER**, set before that `render` as `setFocus` is, so the frame is drawn once.
   */
  setResult(on: boolean): void {
    this.#result = on
  }

  render(frame: ClifState | null, controls: ControlState): void {
    this.#frame = frame
    this.steps.update(controls)
    // ON EVERY RENDER, since a choice in another CLIF view, a link or an undo changes the program's listing.
    this.#switch?.sync()
    this.#draw()
  }

  /**
   * Lay the listing out `layout`'s way, and report it for the workspace. **ONE DRAW, AT THE SCROLL THE LISTING HAS**:
   * the rows are the same rows, so the grid keeps its scroll, its active row and a link's hold, and draws them in their
   * new columns in the frame of the change.
   */
  #setLayout(layout: ClifLayout): void {
    this.#layout = layout
    this.#on.clifDisplay?.({ layout })
    this.#draw()
  }

  #draw(): void {
    this.#drawNotice()
    const frame = this.#frame
    const shown = this.#shown
    const next = frame?.next ?? null
    this.#listing.show(next === null || shown === null ? null : shown.rows.ordinalOf(next), frame?.step ?? null)
    this.#values.show(frame === null ? null : clifValues(frame, this.#result))
    this.#stack.show(frame === null || shown === null ? null : clifStack(frame, shown.listing))
    this.#heap.show(frame === null ? null : clifHeap(frame))
  }

  /**
   * Put `clifNotice`'s words at the top of the listing's body, or take them away. **A RETRY WITH THE FOCUS HANDS IT TO
   * THE LISTING'S TOGGLE** as it goes, as the listing's *follow* button does: removed, it would leave the focus
   * nowhere.
   */
  #drawNotice(): void {
    const notice = clifNotice(this.#on.clifLoad?.state() ?? 'idle', this.#program, this.#on.legReason?.() ?? '')
    const said = notice === null ? null : noticeKey(notice)
    if (said === this.#said) return
    this.#said = said
    const focused = this.#notice.contains(document.activeElement)
    if (notice === null) this.#notice.remove()
    else {
      this.#notice.replaceChildren(...noticeContent(notice, () => this.#on.clifLoad?.retry()))
      if (!this.#notice.isConnected) this.#listing.panel.body.prepend(this.#notice)
    }
    if (focused && !this.#notice.contains(document.activeElement)) this.#listing.panel.toggle.focus()
  }

  /** The Inst row of the listing's instruction `ordinal`. */
  #instRow(ordinal: number): ClifRow | undefined {
    const shown = this.#shown
    const row = shown?.rows.rowOf[ordinal]
    return row === undefined ? undefined : shown?.listing.rows[row]
  }

  #ordinalsOf(pcs: readonly number[]): number[] {
    const rows = this.#shown?.rows
    return rows === undefined ? [] : pcs.flatMap((pc) => rows.ordinalsOfPc(pc))
  }

  /** An instruction's row, which reads `pc13`, the spaces its layout leaves after that, and the line as printed. */
  #fillInstr(ordinal: number, cell: HTMLElement): void {
    const row = this.#shown?.rows.rowOf[ordinal]
    const r = this.#instRow(ordinal)
    const pc = document.createElement('span')
    pc.className = 'rxm-pc'
    pc.textContent = pcColumn(r?.pc ?? null)
    cell.append(pc, `${' '.repeat(this.#lead(row))}${r?.text ?? ''}`)
  }

  /** A row that shows no instruction, named by its index in the listing: the spaces its layout gives it, its line. */
  #fillLabel(name: string, cell: HTMLElement): void {
    const row = Number(name)
    const r = this.#shown?.listing.rows[row]
    if (r === undefined) return
    if (r.kind !== 'Inst') cell.classList.add(LABEL_CLASS[r.kind])
    cell.textContent = `${' '.repeat(this.#lead(row))}${r.text}`
  }

  /** The spaces before listing row `row`'s text in the layout shown, `clifLeads`'s; none for a row it does not have. */
  #lead(row: number | undefined): number {
    return row === undefined ? 0 : (this.#shown?.leads[this.#layout][row] ?? 0)
  }
}

/**
 * *as built* and *optimised*, each titled with what it lists (CLIF view design §4, *The switch*): a radio group,
 * `radioGroup`'s keys and its roving Tab stop, whose choice is the program's.
 */
function listingSwitch(on: NonNullable<PaneEvents['clifListing']>): { readonly el: HTMLElement; sync(): void } {
  const group = radioGroup(
    {
      label: 'listing',
      choices: [
        { value: 'as-built', label: 'as built', hint: () => "redextape's lowering, before Cranelift's passes" },
        {
          value: 'optimised',
          label: 'optimised',
          hint: () => "Cranelift's output at every opt level from O1 up, the same for every target",
        },
      ],
      current: () => on.current(),
      pick: (v) => on.choose(v === 'optimised' ? 'optimised' : 'as-built'),
    },
    'clif-listing-choice',
  )
  group.el.className = 'clif-switch'
  group.sync()
  return group
}

/** What tells one notice's words from another's. */
function noticeKey(n: ClifNotice): string {
  return n.kind === 'declined' ? `declined ${n.text}` : n.kind
}

/** A notice's words, and after a failure's, the Retry that asks for the load again. */
function noticeContent(n: ClifNotice, retry: () => void): (string | HTMLElement)[] {
  switch (n.kind) {
    case 'loading':
      return [CLIF_COPY.loading]
    case 'declined':
      return [CLIF_COPY.declined(n.text)]
    case 'failed': {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'clif-retry'
      button.textContent = CLIF_COPY.retry
      button.addEventListener('click', retry)
      return [CLIF_COPY.failed, ' ', button]
    }
  }
}
