import { watchIntent } from './clif-intent'
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
  widestPc,
} from './clif-view'
import type { ControlState } from './controls'
import { ListingPanel } from './listing-panel'
import type { McAnswer } from './machine-code'
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
import { MC_COPY, type McNotice, type McRows, mcFunctionLine, mcLine, mcNotice, mcRows, mcTitle } from './mc-view'
import type { PaneEvents } from './pane-chrome'
import { PanelStack, type Shares } from './panel-stack'
import { type ClifCompiled, knownTarget, type Listing, MC_TARGETS, type McTarget } from './protocol'
import type { PaneView } from './sessions'
import type { ClifAt, ClifListing, ClifRow, ClifRowKind, ClifState, McListing } from './types'
import { radioGroup } from './view-header'
import { type ClifDisplay, DEFAULT_CLIF_DISPLAY, mcDisplay } from './workspace'

/**
 * What the panel says of each target: its choice's hint, naming the ABI shown, and whether it has the syntax choice.
 * **A `Record`**, so a target the bindings gain is a type error here until the panel can say what it is.
 */
const TARGET_WORDS: Record<McTarget, { readonly hint: string; readonly syntaxes: boolean }> = {
  'x86-64': { hint: 'x86-64 as Linux calls it, System V', syntaxes: true },
  arm64: { hint: 'arm64 as Linux calls it; Apple’s arm64 differs in a few calls', syntaxes: false },
}

/** Mints each view's listing a prefix for its cells' ids, which `aria-activedescendant` names. */
let listingsMinted = 0

/** Which panels a CLIF view has, by the name each is stored under in the workspace (`panes.ts`'s `LEG_PANELS`). */
export type ClifPanels = Partial<Record<'listing' | 'code' | 'values' | 'stack' | 'heap', boolean>>

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
  /**
   * The listing `#program` carries, which listing it is, its rows and the spaces before each row's text in each layout;
   * `null` for none. **THE MACHINE CODE SHOWN IS `level`'S**, so that a view seeded while a switch holds the old listing
   * shows the old listing's code beside it.
   */
  #shown: {
    readonly listing: ClifListing
    readonly level: Listing
    readonly rows: ClifRows
    readonly leads: { readonly [L in ClifLayout]: readonly number[] }
  } | null = null
  /** How the listing is laid out: the view's own choice, as a λ view's *expand all* is. */
  #layout: ClifLayout
  /** The view's display settings as stored, which a change reports whole, with only what has been chosen in it. */
  #display: ClifDisplay
  /** The machine code panel (machine code panel design §4): the program's code on the view's target. */
  #machine: ListingPanel
  /**
   * Whether the pin `#linked` holds was made in another view, which scrolls this one to it (`setLink`): given again to
   * the machine code panel when its rows come, as a view seeded after the pin is given it (`draw.ts`).
   */
  #linkScroll = false
  /** The answer the machine code panel was last drawn from, `null` for none. */
  #mcAnswer: McAnswer | null = null
  /** The code the machine code panel shows and its rows; `null` for none. */
  #mcShown: { readonly code: McListing; readonly rows: McRows } | null = null
  /** The machine code ordinals of the clif instruction about to run, which the panel marks as current. */
  #mcCurrent: ReadonlySet<number> = new Set()
  /** What the machine code panel says instead of its rows, as `#notice` is the listing's. */
  #mcNotice: HTMLElement
  #mcSaid: string | null = null
  /** What the machine code panel's header says beside its name: its target and level. */
  #mcTitle: HTMLElement
  #mcTarget: ReturnType<typeof radioGroup>
  #mcSyntax: ReturnType<typeof radioGroup>
  #frame: ClifState | null = null
  /** Whether `#frame` is the run's result, which the values and the heap mark: `setResult`. */
  #result = false
  #listing: ListingPanel
  #values: RoomPanel<ValuesView>
  #stack: MachinePanel<StackView>
  #heap: RoomPanel<HeapView>
  /**
   * What the listing says instead of the listing: on the page while `clifNotice` gives one, and a `status` region, so
   * a change of what it says is read out. **ONE ELEMENT, FILLED AGAIN ONLY WHEN THE WORDS CHANGE** (`#said`), since
   * every frame draws it and a region filled again says itself again.
   */
  #notice: HTMLElement
  /** What `#notice` says, or `null` while it is off the page. */
  #said: string | null = null
  /** The rxm pcs the last link pinned and the running focus names, kept for the machine code's rows to come. */
  #linked: readonly number[] = []
  #focused: readonly number[] = []
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
    this.#display = display
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
    // THE MACHINE CODE'S BYTES, IN THE SAME MENU, for *compact*'s reason: how the panel shows its rows.
    this.menu.addCheck('clif-bytes', 'machine code bytes', {
      on: () => mcDisplay(this.#display).bytes,
      set: (on) => this.#setDisplay({ bytes: on }),
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

    // A MACHINE ROW WITH A PC LINKS THAT RXM INSTRUCTION, as a clif row with that pc does (machine code panel design §4,
    // *Links*). CLOSED BY DEFAULT: nothing of a target's package is fetched until the panel is opened or its intent
    // shown. **NAMED `code`, NOT `machine`**: `machine` is the values, call stack and heap row's region, whose share a
    // workspace already stores under that name.
    this.#machine = new ListingPanel({
      name: 'code',
      label: 'machine code',
      open: panels.code ?? false,
      reattachText: 'follow current instruction',
      classes: { box: 'clif-listing mc-listing', spacer: 'clif-spacer', rows: 'clif-rows', row: 'clif-row' },
      cellClass: 'clif-cell',
      idPrefix: `mc-grid-${listingsMinted++}`,
      fillInstr: (ordinal, cell, row) => this.#fillMachine(ordinal, cell, row),
      fillLabel: (name, cell) => this.#fillMachineLabel(name, cell),
      activate: (ordinal) => on.linkInstr?.(this.#mcRow(ordinal)?.pc ?? null),
      onToggle: (open) => {
        on.panel?.('code', open)
        this.#draw()
      },
    })
    const machinePanel = this.#machine.panel
    // A CLASS OF ITS OWN, NOT THE LISTING'S `clif-notice`: what finds the listing's notice in the view must not find
    // the panel's.
    this.#mcNotice = document.createElement('p')
    this.#mcNotice.className = 'mc-notice'
    this.#mcNotice.setAttribute('role', 'status')
    this.#mcTitle = document.createElement('span')
    this.#mcTitle.className = 'mc-title'
    this.#mcTarget = radioGroup(
      {
        label: 'target',
        choices: MC_TARGETS.map((target) => ({
          value: target,
          label: target,
          hint: () => TARGET_WORDS[target].hint,
        })),
        current: () => this.#target(),
        pick: (v) => this.#setDisplay({ target: knownTarget(v) ?? mcDisplay(DEFAULT_CLIF_DISPLAY).target }),
      },
      'clif-listing-choice',
    )
    this.#mcTarget.el.className = 'clif-switch mc-target'
    this.#mcSyntax = radioGroup(
      {
        label: 'syntax',
        choices: [
          { value: 'att', label: 'AT&T', hint: () => 'as Cranelift prints its own code' },
          { value: 'intel', label: 'Intel', hint: () => 'destination first, no sigils' },
        ],
        current: () => mcDisplay(this.#display).syntax,
        pick: (v) => this.#setDisplay({ syntax: v === 'intel' ? 'intel' : 'att' }),
      },
      'clif-listing-choice',
    )
    this.#mcSyntax.el.className = 'clif-switch mc-syntax'
    // THE TITLE AND THE TWO CHOICES ARE ONE GROUP, FIRST IN THE ACTIONS, the re-attach and the maximise after it: the
    // syntax choice comes and goes with the target, and the re-attach with a scroll, so only what follows the target
    // choice may come and go, or it would move under the pointer (`style.css`'s `.mc-head`).
    const head = document.createElement('span')
    head.className = 'mc-head'
    head.append(this.#mcTitle, this.#mcTarget.el, this.#mcSyntax.el)
    machinePanel.actions.prepend(head)
    // A TARGET'S PACKAGE IS FETCHED ON INTENT: the pointer resting on its choice, or the choice taking focus, and the
    // panel's own toggle for the target it would show.
    for (const target of MC_TARGETS) {
      const b = this.#mcTarget.el.querySelector<HTMLElement>(`[role="radio"][data-value="${target}"]`)
      if (b !== null) watchIntent(b, () => on.machineCode?.intent(target))
    }
    watchIntent(machinePanel.toggle, () => on.machineCode?.intent(this.#target()))

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
    // THE THREE AS WIDE AS EACH OTHER (the squeezed values design): the call stack's and the heap's least width holds a
    // header's count whole (the machine panels row design §5.1), and the values' holds a value of 20 digits and the
    // register after it, which most runs show.
    const row = new MachineRow({
      values: this.#values.panel,
      stack: this.#stack.panel,
      heap: this.#heap.panel,
      columns: [14.75, 14.75, 14.75],
    })

    const body = document.createElement('div')
    body.className = 'clif-pane'
    body.append(listingPanel.el, machinePanel.el, row.el, row.stackRegion, row.heapRegion)
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
        {
          name: 'code',
          label: 'machine code',
          el: machinePanel.el,
          share: 2,
          panels: [machinePanel],
          bodies: () => [machinePanel.body],
        },
        ...row.regions,
      ],
      sizes,
      (next) => on.panelSizes?.(next),
    )
    // THE RE-ATTACH AND THE MAXIMISE ARE ONE GROUP, LAST IN THE ACTIONS, so they take a second line together where the
    // header has no room for them beside the name, the title and the choices (`style.css`'s `.mc-tail`).
    const tail = document.createElement('span')
    tail.className = 'mc-tail'
    tail.append(...machinePanel.actions.querySelectorAll(':scope > .table-reattach, :scope > .panel-maximise'))
    machinePanel.actions.append(tail)
    row.follow(host, stack)
    this.#draw()
  }

  /**
   * The program's CLIF: its listing, or why it has none; `null` while none has come, which the view says is loading.
   * Its rows do not change as the run moves. The values and the heap forget the room their texts needed, which was
   * another listing's run.
   */
  setProgram(p: ClifCompiled | null): void {
    this.#program = p
    this.#shown =
      p !== null && 'listing' in p
        ? {
            listing: p.listing,
            level: p.level,
            rows: clifRows(p.listing),
            leads: { compact: clifLeads(p.listing, 'compact'), exact: clifLeads(p.listing, 'exact') },
          }
        : null
    this.#listing.setSource(this.#shown?.rows.source ?? null)
    // EVERY FRAME'S PC AS WIDE AS THE LISTING'S WIDEST LABEL: the running frame's names the instruction the run is at,
    // which changes at each step, and a frame too long for its panel goes on below, so a label of another width would
    // move the stack's lines at a step that neither calls nor returns.
    this.#stack.panel.body.style.setProperty(
      '--ret-room',
      `${this.#shown === null ? 0 : widestPc(this.#shown.listing)}ch`,
    )
    this.#values.forget()
    this.#heap.forget()
    this.#frame = null
    this.#draw()
  }

  /**
   * Mark every Inst row whose srcloc is one of the rxm `pcs` a link pinned, and every machine instruction of those pcs:
   * `ListingPanel.setLink`.
   */
  setLink(pcs: readonly number[], scrollTo: boolean): void {
    this.#linked = pcs
    this.#linkScroll = scrollTo
    this.#listing.setLink(this.#ordinalsOf(pcs), scrollTo)
    this.#machine.setLink(this.#mcOrdinalsOf(pcs), scrollTo)
  }

  /** Mark every Inst row, and machine instruction, of the rxm `pcs` the running focus names: `ListingPanel.setFocus`. */
  setFocus(pcs: readonly number[]): void {
    this.#focused = pcs
    this.#listing.setFocus(this.#ordinalsOf(pcs))
    this.#machine.setFocus(this.#mcOrdinalsOf(pcs))
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
    this.#setDisplay({ layout })
  }

  /** Change the view's display settings by `change`, report them whole for the workspace, and draw. */
  #setDisplay(change: Partial<ClifDisplay>): void {
    this.#display = { ...this.#display, ...change }
    this.#on.clifDisplay?.(this.#display)
    this.#draw()
  }

  /** The target this view's machine code panel shows while it is open; `null` while it is closed. */
  machineShown(): McTarget | null {
    return this.#machine.panel.isOpen() ? this.#target() : null
  }

  /** The machine code panel's target. */
  #target(): McTarget {
    return mcDisplay(this.#display).target
  }

  #draw(): void {
    this.#drawNotice()
    const frame = this.#frame
    const shown = this.#shown
    const ordinal = (at: ClifAt | null) => (at === null || shown === null ? null : shown.rows.ordinalOf(at))
    const pcOf = (o: number | null) => (o === null ? null : (this.#instRow(o)?.pc ?? null))
    const next = ordinal(frame?.next ?? null)
    // ONCE THE RUN HAS ENDED `next` IS NULL AND `at` STANDS ON THE INSTRUCTION IT ENDED AT: the listing and the machine
    // code follow that, unmarked, so the end shows where the run stopped and calls nothing next.
    const stood = frame === null ? null : ordinal(frame.next ?? frame.at)
    this.#listing.show(next, frame?.step ?? null, { follow: stood })
    this.#values.show(frame === null ? null : clifValues(frame, this.#result))
    this.#stack.show(frame === null || shown === null ? null : clifStack(frame, shown.listing))
    this.#heap.show(frame === null ? null : clifHeap(frame, this.#result))
    this.#drawMachine(pcOf(next), pcOf(stood))
  }

  /**
   * The machine code panel: its header for the target shown, its answer asked for while it is open, its rows when the
   * view has a listing and the answer is in, the machine instructions of the clif instruction about to run, at `pc`,
   * marked, and those of the one at `follow` followed (machine code panel design §4, *Following*): the same while the
   * run can go on, and once it has ended `pc` is `null` and `follow` the instruction it ended at.
   */
  #drawMachine(pc: number | null, follow: number | null): void {
    const target = this.#target()
    const hasListing = this.#shown !== null
    const listing = this.#shown?.level ?? this.#on.clifListing?.current() ?? 'as-built'
    const mc = this.#on.machineCode
    const declined = this.#program !== null && 'error' in this.#program
    // A NEW TITLE IS A NEW ELEMENT: a cut title's tooltip is `cut-text.ts`'s, which relies on no text rewritten in place.
    const title = mcTitle(target, listing)
    if (this.#mcTitle.textContent !== title) {
      const next = document.createElement('span')
      next.className = 'mc-title'
      next.textContent = title
      this.#mcTitle.replaceWith(next)
      this.#mcTitle = next
    }
    this.#mcTarget.sync()
    this.#mcSyntax.sync()
    // ON ARM64 THE SYNTAX CHOICE KEEPS ITS ROOM, unseen and out of the tab order: in a narrow header the name and the
    // title would take the room back, and the target choice would move under the pointer that chose arm64.
    this.#mcSyntax.el.style.visibility = TARGET_WORDS[target].syntaxes ? '' : 'hidden'
    // ASKED BEFORE THE LISTING COMES, while the view waits for it after a compile, so that the code is on its way
    // beside the listing; never for a program the lowering declined, which has none.
    const open = this.#machine.panel.isOpen()
    if (open && !declined) mc?.want(target, listing)
    const answer = hasListing ? (mc?.code(target, listing) ?? null) : null
    if (answer !== this.#mcAnswer) {
      this.#mcAnswer = answer
      this.#mcShown = answer !== null && 'code' in answer ? { code: answer.code, rows: mcRows(answer.code) } : null
      // THE BYTES COLUMN IS AS WIDE AS THE LISTING'S WIDEST ROW'S BYTES, two digits and a space each: no row's
      // instruction steps right of the others', and no room is kept for bytes no row has, as x86-64's fifteen would
      // be on arm64's four.
      const widest = Math.max(0, ...(this.#mcShown?.code.rows.map((r) => r.bytes.length / 2) ?? []))
      this.#machine.panel.body.style.setProperty('--mc-bytes', `${Math.max(0, 3 * widest - 1)}ch`)
      this.#machine.setSource(this.#mcShown?.rows.source ?? null)
      // NEW ROWS SCROLL TO THE PIN AS THE LISTING'S DO when they come after it, held until the run moves: a pin made
      // before the code came would otherwise leave the panel on the run's rows with the pinned ones out of view.
      this.#machine.setLink(this.#mcOrdinalsOf(this.#linked), this.#linkScroll)
      this.#machine.setFocus(this.#mcOrdinalsOf(this.#focused))
    }
    this.#mcCurrent = new Set(pc === null ? [] : this.#mcOrdinalsOf([pc]))
    // A CLOSED PANEL SAYS NOTHING: a notice in its hidden body would still be in the view's DOM, a status a screen
    // reader can be pointed at and one more `role="status"` beside the listing's.
    const reason = this.#on.legReason?.() ?? ''
    this.#drawMachineNotice(open && mc !== undefined ? mcNotice(mc.load(target), answer, this.#program, reason) : null)
    // FOLLOWING KEEPS THE CURRENT ROWS IN VIEW AS ONE BLOCK, as the listing centres its instruction about to run: a clif
    // instruction's machine instructions are one function's, so the rows from its first to its last are centred
    // together, another instruction's among them, or start at the box's top when they are more than it shows.
    const current = [...this.#mcCurrent].sort((a, b) => a - b)
    const followed = follow === null ? [] : this.#mcOrdinalsOf([follow]).sort((a, b) => a - b)
    this.#machine.show(current[0] ?? null, this.#frame?.step ?? null, {
      follow: followed[0] ?? null,
      last: followed.at(-1) ?? null,
    })
  }

  /** `#drawNotice` for the machine code panel: `notice`'s words at the top of its body, or none. */
  #drawMachineNotice(notice: McNotice | null): void {
    const said = notice === null ? null : notice.kind === 'declined' ? `declined ${notice.text}` : notice.kind
    if (said === this.#mcSaid) return
    this.#mcSaid = said
    const focused = this.#mcNotice.contains(document.activeElement)
    if (notice === null) this.#mcNotice.remove()
    else {
      this.#mcNotice.replaceChildren(...mcNoticeContent(notice, () => this.#retryMachine()))
      if (!this.#mcNotice.isConnected) this.#machine.panel.body.prepend(this.#mcNotice)
    }
    if (focused && !this.#mcNotice.contains(document.activeElement)) this.#machine.panel.toggle.focus()
  }

  #retryMachine(): void {
    this.#on.machineCode?.retry(this.#target())
    this.#draw()
  }

  /** The machine code row of the panel's instruction `ordinal`. */
  #mcRow(ordinal: number): McListing['rows'][number] | undefined {
    const shown = this.#mcShown
    const row = shown?.rows.rowOf[ordinal]
    return row === undefined ? undefined : shown?.code.rows[row]
  }

  #mcOrdinalsOf(pcs: readonly number[]): number[] {
    const rows = this.#mcShown?.rows
    return rows === undefined ? [] : pcs.flatMap((pc) => rows.ordinalsOfPc(pc))
  }

  /**
   * A machine instruction's row: its offset, its pc, its bytes while they are shown, its instruction in the view's
   * syntax, and the function a relocation in it is filled in with. **THE CURRENT CLIF INSTRUCTION'S EVERY MACHINE
   * INSTRUCTION IS MARKED**, beside the one the panel follows, **ON ITS ROW**, where the link's, the focus's and the
   * followed row's marks are: on the cell, its wash would paint over theirs.
   */
  #fillMachine(ordinal: number, cell: HTMLElement, row: HTMLElement): void {
    const r = this.#mcRow(ordinal)
    if (r === undefined) return
    const { syntax, bytes } = mcDisplay(this.#display)
    const line = mcLine(r, syntax, bytes)
    const part = (className: string, text: string): HTMLElement => {
      const span = document.createElement('span')
      span.className = className
      span.textContent = text
      return span
    }
    cell.append(part('mc-offset', line.offset), part('rxm-pc', line.pc))
    if (bytes) cell.append(part('mc-bytes', line.bytes))
    cell.append(line.text)
    if (line.callee !== '') cell.append(part('mc-callee', line.callee))
    if (this.#mcCurrent.has(ordinal)) row.classList.add('is-current')
  }

  /** A machine code row that shows no instruction: a function's header, or the blank before it. */
  #fillMachineLabel(name: string, cell: HTMLElement): void {
    const code = this.#mcShown?.code
    const r = code?.rows[Number(name)]
    if (code === undefined || r === undefined || r.kind !== 'Function') return
    cell.classList.add('is-function')
    cell.textContent = mcFunctionLine(code, r.function)
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

/** A machine code notice's words, and after a failure's, the Retry that loads the package again. */
function mcNoticeContent(n: McNotice, retry: () => void): (string | HTMLElement)[] {
  switch (n.kind) {
    case 'loading':
      return [MC_COPY.loading]
    case 'building':
      return [MC_COPY.building]
    case 'declined':
      return [MC_COPY.declined(n.text)]
    // NO RETRY: the package would stop on the same program again; a new program asks again.
    case 'trapped':
      return [MC_COPY.trapped]
    case 'failed': {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'mc-retry'
      button.textContent = MC_COPY.retry
      button.addEventListener('click', retry)
      return [MC_COPY.failed, ' ', button]
    }
  }
}
