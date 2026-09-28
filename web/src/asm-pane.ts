import {
  backRefs,
  calleeOf,
  frames,
  heapSummary,
  instrParts,
  type ListingRow,
  listingRows,
  registerRows,
  rowsOfPcs,
  unwrittenLegend,
  unwrittenMeaning,
  wordText,
} from './asm-view'
import type { ControlState } from './controls'
import { n } from './format'
import type { Dir } from './layout'
import type { PaneChoice, PaneEvents, SplitChoices } from './pane-chrome'
import { createPanel, type Panel } from './panel'
import type { Leg } from './protocol'
import type { Binding, PaneOption } from './sessions'
import { stepControls } from './step-controls'
import type { AsmProgram, AsmState } from './types'
import { type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
import { type GridRows, VirtualGrid } from './virtual-grid'

/** Mints each view's listing a prefix for its cells' ids, which `aria-activedescendant` names. */
let listingsMinted = 0

/** Which panels a view has, by the name each is stored under in the workspace (`workspace.ts`'s `Panels`). */
export type AsmPanels = {
  readonly listing?: boolean
  readonly registers?: boolean
  readonly stack?: boolean
  readonly heap?: boolean
}

/**
 * The asm view (Plan 7 part 5 spec §6): the program's listing, and the machine's registers, call stack and heap as it
 * stands at the displayed step.
 *
 * **A PAGE OF PANELS SHARING THE VIEW'S HEIGHT, AS THE TM VIEW'S ARE** (spec §6.1; `style.css`'s `.asm-pane` rules):
 * the listing two shares, the registers and call stack side by side in one share, the heap one. Each panel's toggle and
 * actions sit in its own header, not the view's (amendment 9), and its open state is saved per view.
 *
 * **THE LISTING IS A `VirtualGrid`**, the rule table's (amendment 7): one tab stop, a roving active row, a click that
 * survives the redraw focusing causes, and following the instruction about to run until the user scrolls away.
 *
 * **THE PANELS ARE DRAWN WHOLE, NOT VIRTUALIZED.** Each shows a window core already bounded (`AsmState`'s: 64 locals, 16
 * arguments, 8 frames, 16 cells and 16 boxes, set in `protocol.ts`), so a frame's panels are at most a few hundred short
 * lines however long the run.
 *
 * `AsmPane` SATISFIES `PaneView<AsmState>`, as the λ and TM views satisfy theirs, with no `implements` clause —
 * `sessions.ts`'s `PaneView` doc says why the parameterisation is the check.
 */
export class AsmPane {
  #header: ViewHeader
  #steps: ReturnType<typeof stepControls>
  #menu: ViewMenu
  /** What this view's split menus offer — `TmPane.#choices`'s twin. */
  #choices: SplitChoices = { options: [], sourceAvailable: false, current: null }
  #body: HTMLElement
  #program: AsmProgram | null = null
  #rows: readonly ListingRow[] = []
  /** Each instruction's row in `#rows`, so following and the marks find an instruction's row in one lookup. */
  #rowOf: number[] = []
  #frame: AsmState | null = null
  /** The instructions a link pinned, by index — marked `is-linked` (spec §6.6). */
  #linked: ReadonlySet<number> = new Set()
  /** The instructions the running focus names — marked `is-focus`, a second layer beside the pin, as the TM view's. */
  #focused: ReadonlySet<number> = new Set()
  #grid: VirtualGrid
  #listingPanel: Panel
  /** Re-attaches following — `follow current instruction`, in the listing panel's header (amendment 9). */
  #reattach: HTMLButtonElement
  #registersPanel: Panel
  #registers: HTMLElement
  #stackPanel: Panel
  #stack: HTMLElement
  #stackCount: HTMLElement
  #heapPanel: Panel
  #heap: HTMLElement
  #heapCount: HTMLElement

  /**
   * `panels` is the view's stored panel state, read once here; each panel reports every later toggle through
   * `on.panel`. Every panel opens by default.
   */
  constructor(host: HTMLElement, on: PaneEvents, panels: AsmPanels = {}) {
    this.#header = viewHeader(on.rebind)
    this.#steps = stepControls(on)
    // NO `format` AND NO `edit a copy`: a view showing a running leg has no document to format, and a copy of the asm is
    // part 5c's. Removed, not disabled — the umbrella's rule for a control that cannot apply here.
    this.#menu = viewMenu(this.#header.actions, {
      ...(on.splitRow !== undefined && on.splitColumn !== undefined
        ? { split: (dir: Dir, c: PaneChoice) => (dir === 'row' ? on.splitRow?.(c) : on.splitColumn?.(c)) }
        : {}),
      ...(on.close !== undefined ? { close: on.close } : {}),
      choices: () => this.#choices,
    })

    // ADDED AND REMOVED, NEVER DISABLED — the rule table's `follow current rule`, for the same reason: a re-attach does
    // something only while the listing has stopped following. The grid's `beforeDraw` keeps `hidden` in step.
    this.#reattach = document.createElement('button')
    this.#reattach.type = 'button'
    this.#reattach.className = 'table-reattach'
    this.#reattach.textContent = 'follow current instruction'
    this.#reattach.hidden = true
    this.#reattach.addEventListener('click', () => {
      const had = document.activeElement === this.#reattach
      this.#grid.attach()
      // THE BUTTON HIDES ITSELF AND MUST NOT TAKE THE FOCUS WITH IT: the panel's own toggle, beside it, takes it.
      if (had && this.#reattach.hidden) this.#listingPanel.toggle.focus()
    })

    // THE LISTING (spec §6.2). A row links the construct its instruction was lowered from (spec §6.6); a label row names
    // no instruction and links nothing.
    this.#grid = new VirtualGrid({
      classes: { box: 'asm-listing', spacer: 'asm-spacer', rows: 'asm-rows', row: 'asm-row' },
      idPrefix: `asm-grid-${listingsMinted++}`,
      isOpen: () => this.#listingPanel.isOpen(),
      rows: () => this.#listingRows(),
      activate: (i) => {
        const row = this.#rows[i]
        if (row?.kind === 'instr') on.linkInstr?.(row.pc)
      },
      beforeDraw: () => {
        this.#reattach.hidden = this.#program === null || this.#grid.following || !this.#listingPanel.isOpen()
      },
    })
    // REDRAWN ON THE WAY UP AND DOWN, for the rule table's reasons: the draw keeps the re-attach's `hidden` true while
    // the listing is closed, and a listing reopened after steps taken while it was closed has to follow again.
    this.#listingPanel = createPanel({
      name: 'listing',
      label: 'listing',
      body: this.#grid.el,
      open: panels.listing ?? true,
      onToggle: (open) => {
        this.#grid.draw()
        on.panel?.('listing', open)
      },
    })
    this.#listingPanel.actions.append(this.#reattach)

    this.#registers = document.createElement('div')
    this.#registers.className = 'asm-registers'
    this.#registersPanel = createPanel({
      name: 'registers',
      label: 'registers',
      body: this.#registers,
      open: panels.registers ?? true,
      onToggle: (open) => on.panel?.('registers', open),
    })

    this.#stack = document.createElement('ol')
    this.#stack.className = 'asm-stack'
    this.#stackCount = document.createElement('span')
    this.#stackCount.className = 'panel-note'
    this.#stackPanel = createPanel({
      name: 'stack',
      label: 'call stack',
      body: this.#stack,
      open: panels.stack ?? true,
      onToggle: (open) => on.panel?.('stack', open),
    })
    this.#stackPanel.actions.append(this.#stackCount)

    this.#heap = document.createElement('ul')
    this.#heap.className = 'asm-heap'
    this.#heapCount = document.createElement('span')
    this.#heapCount.className = 'panel-note'
    this.#heapPanel = createPanel({
      name: 'heap',
      label: 'heap',
      body: this.#heap,
      open: panels.heap ?? true,
      onToggle: (open) => on.panel?.('heap', open),
    })
    this.#heapPanel.actions.append(this.#heapCount)

    // THE REGISTERS AND THE CALL STACK SHARE ONE ROW, side by side, and stack when the view is too narrow for both
    // (spec §6.1) — a wrapping flex row, `style.css`'s `.asm-machine`.
    const machine = document.createElement('div')
    machine.className = 'asm-machine'
    machine.append(this.#registersPanel.el, this.#stackPanel.el)

    this.#body = document.createElement('div')
    this.#body.className = 'asm-pane'
    this.#body.append(this.#listingPanel.el, machine, this.#heapPanel.el)
    this.#header.steps.append(this.#steps.el)
    host.replaceChildren(this.#header.el, this.#body)
  }

  /**
   * Set once per compile: the listing and its labels, which do not change as the run moves. `null` for a session with
   * no asm leg, which clears the view.
   */
  setProgram(p: AsmProgram | null): void {
    this.#program = p
    this.#rows = p === null ? [] : listingRows(p)
    this.#rowOf = rowsOfPcs(this.#rows)
    // A new compile invalidates every instruction index a link or the running focus named.
    this.#linked = new Set()
    this.#focused = new Set()
    this.#grid.reset()
    this.#frame = null
    this.#draw()
  }

  /**
   * Mark the instructions a link pinned, scrolling the listing to the first of them unless the click came from this
   * view (`scrollTo`): scrolling a list the user just clicked in moves the row out from under the pointer. The
   * scroll holds over following until the run moves and leaves following as it was — `VirtualGrid.scrollToRow`.
   * A pin with no instructions here releases an earlier link's hold instead, for `TmPane.setLink`'s reason.
   */
  setLink(instrs: readonly number[], scrollTo: boolean): void {
    this.#linked = new Set(instrs)
    if (scrollTo) {
      const first = [...instrs].sort((a, b) => a - b)[0]
      const row = first === undefined ? undefined : this.#rowOf[first]
      if (row === undefined) this.#grid.release()
      else this.#grid.scrollToRow(row)
    }
    this.#grid.draw()
  }

  /**
   * Mark the instructions the running focus names. **A PURE SETTER, CALLED BEFORE `render`**, for `TmPane.setFocus`'s
   * reason: `render` draws anyway, and drawing here too would build every row twice a frame.
   */
  setFocus(instrs: readonly number[]): void {
    this.#focused = new Set(instrs)
  }

  /** `copy · not linked`, in the title. The asm leg has no copies until part 5c, so today it is always `false`. */
  setDetached(detached: boolean): void {
    this.#header.setDetached(detached)
  }

  /** The `steps` switch, per `PaneView.setStepsShown` — the view's header owns the slot. */
  setStepsShown(shown: boolean): void {
    this.#header.setStepsShown(shown)
  }

  /** Offer `options` in the title and show `current` as the pair in force — `TmPane.setBindings`'s contract. */
  setBindings(options: PaneOption[], current: Binding<Leg>): void {
    this.#header.setBindings(options, current)
  }

  /** Which layout gestures this view offers, and what a split may create — `TmPane.setLayoutControls`'s contract. */
  setLayoutControls(canClose: boolean, canSplit: boolean, choices: SplitChoices): void {
    this.#choices = choices
    this.#menu.setLayout(canClose, canSplit)
  }

  render(frame: AsmState | null, controls: ControlState): void {
    this.#frame = frame
    this.#steps.update(controls)
    this.#draw()
  }

  #draw(): void {
    this.#grid.draw()
    this.#drawRegisters()
    this.#drawStack()
    this.#drawHeap()
  }

  /**
   * The listing's rows for one draw: a label row names its label; an instruction row reads `pc5  jz  r1, else2`. The
   * instruction about to run is `.is-next` and says "runs next" in words, as generated content — the not-colour cue
   * the TM view's "fires next" has (spec §6.2) — and it is the row following keeps in view.
   */
  #listingRows(): GridRows {
    if (this.#program === null) return { count: null, follow: null, frame: null, fill: () => {} }
    const program = this.#program
    const next = this.#frame?.next ?? null
    const nextRow = next === null ? null : (this.#rowOf[next] ?? null)
    return {
      count: this.#rows.length,
      follow: nextRow,
      // THE STEP THIS DRAW SHOWS, NOT WHETHER THE FOLLOWED ROW MOVED — `TmPane.#tableRows`'s reason, one leg over:
      // the row above is the instruction the machine is ABOUT to run, and a jump to itself leaves that row
      // unchanged, so a hold keyed on `follow` alone would never release (amendment 21).
      frame: this.#frame?.step ?? null,
      fill: (i, el, cell) => {
        const row = this.#rows[i]
        if (row === undefined) return
        cell.className = 'asm-cell'
        if (row.kind === 'label') {
          el.classList.add('is-label')
          cell.textContent = `${row.name}:`
          return
        }
        const { mnemonic, operands } = instrParts(program.listing[row.pc] ?? '')
        const pc = document.createElement('span')
        pc.className = 'asm-pc'
        pc.textContent = `pc${row.pc}`
        const m = document.createElement('b')
        m.className = 'asm-mnemonic'
        m.textContent = mnemonic
        cell.append(pc, m)
        if (operands !== '') cell.append(` ${operands}`)
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

  /**
   * The registers (spec §6.3): each name and word, the register the last step wrote marked *changed*, and each local
   * the current call has not written dimmed and marked `·`, with a legend saying what that means. Every mark also says
   * itself in an `aria-description`, so none is colour alone.
   */
  #drawRegisters(): void {
    const frame = this.#frame
    if (frame === null) {
      this.#registers.replaceChildren()
      return
    }
    const rows = registerRows(frame)
    const legend = unwrittenLegend(frame, rows)
    const list = document.createElement('dl')
    list.className = 'asm-register-list'
    for (const r of rows) {
      const item = document.createElement('div')
      item.className = 'asm-register'
      const name = document.createElement('dt')
      name.textContent = r.unwritten ? `· ${r.name}` : r.name
      const value = document.createElement('dd')
      value.textContent = r.text
      const said: string[] = []
      if (r.changed) {
        item.classList.add('is-changed')
        said.push('changed by the last instruction')
      }
      if (r.unwritten) {
        item.classList.add('is-unwritten')
        said.push(unwrittenMeaning(frame))
      }
      if (said.length > 0) value.setAttribute('aria-description', said.join('; '))
      item.append(name, value)
      list.append(item)
    }
    const notes: HTMLElement[] = []
    const more = (hidden: number, what: string) => {
      if (hidden <= 0) return
      const p = document.createElement('p')
      p.className = 'asm-note'
      p.textContent = `+${n(hidden)} more ${what}`
      notes.push(p)
    }
    more(frame.args_len - frame.args.length, frame.args_len - frame.args.length === 1 ? 'argument' : 'arguments')
    more(frame.locals_len - frame.locals.length, frame.locals_len - frame.locals.length === 1 ? 'local' : 'locals')
    if (legend !== null) {
      const p = document.createElement('p')
      p.className = 'asm-note asm-legend'
      p.textContent = legend
      notes.push(p)
    }
    this.#registers.replaceChildren(list, ...notes)
  }

  /**
   * The call stack (spec §6.4), top first: each frame the function it called, `→ pc14` where `ret` resumes, and the
   * caller's locals as they were at the call. Past the window, `+N more`.
   */
  #drawStack(): void {
    const frame = this.#frame
    const program = this.#program
    if (frame === null || program === null) {
      this.#stackCount.textContent = ''
      this.#stack.replaceChildren()
      return
    }
    this.#stackCount.textContent = frames(frame.depth)
    if (frame.depth === 0) {
      const li = document.createElement('li')
      li.className = 'asm-note'
      li.textContent = 'not inside a call'
      this.#stack.replaceChildren(li)
      return
    }
    const items = frame.frames.map((f) => {
      const li = document.createElement('li')
      li.className = 'asm-frame'
      const callee = document.createElement('b')
      callee.className = 'asm-callee'
      callee.textContent = calleeOf(program, f.ret_pc) ?? '?'
      const ret = document.createElement('span')
      ret.className = 'asm-ret'
      ret.textContent = `→ pc${f.ret_pc}`
      const saved = document.createElement('span')
      saved.className = 'asm-saved'
      const words = f.saved.map((w, i) => `r${i} ${wordText(w)}`)
      if (f.saved_len > f.saved.length) words.push(`+${n(f.saved_len - f.saved.length)} more`)
      saved.textContent = words.join(' · ')
      li.append(callee, ' ', ret, ' ', saved)
      return li
    })
    const hidden = frame.depth - frame.frames.length
    if (hidden > 0) {
      const li = document.createElement('li')
      li.className = 'asm-note'
      li.textContent = `+${n(hidden)} more`
      items.push(li)
    }
    this.#stack.replaceChildren(...items)
  }

  /**
   * The heap (spec §6.5), newest first: `#57  57 → #56  ← r5` — the cell, its head and tail, and the *list* registers
   * that name it — then the boxes. Past the window, `+N older`.
   */
  #drawHeap(): void {
    const frame = this.#frame
    if (frame === null) {
      this.#heapCount.textContent = ''
      this.#heap.replaceChildren()
      return
    }
    this.#heapCount.textContent = heapSummary(frame)
    const items: HTMLElement[] = []
    const line = (lead: string, body: string, refs: readonly string[]) => {
      const li = document.createElement('li')
      li.className = 'asm-cell-line'
      const at = document.createElement('b')
      at.textContent = lead
      li.append(at, ` ${body}`)
      if (refs.length > 0) {
        const r = document.createElement('span')
        r.className = 'asm-refs'
        r.textContent = `← ${refs.join(', ')}`
        li.append(' ', r)
      }
      items.push(li)
    }
    for (const c of frame.cells) {
      line(`#${c.cell}`, `${wordText(c.head)} → ${wordText(c.tail)}`, backRefs(frame, c.cell, 'List'))
    }
    const olderCells = frame.heap_len - frame.cells.length
    if (olderCells > 0) items.push(note(`+${n(olderCells)} older`))
    for (const b of frame.boxes) line(`box #${b.handle}`, wordText(b.content), backRefs(frame, b.handle, 'Box'))
    const olderBoxes = frame.box_len - frame.boxes.length
    if (olderBoxes > 0) items.push(note(`+${n(olderBoxes)} older ${olderBoxes === 1 ? 'box' : 'boxes'}`))
    if (items.length === 0) items.push(note('empty'))
    this.#heap.replaceChildren(...items)
  }
}

function note(text: string): HTMLElement {
  const li = document.createElement('li')
  li.className = 'asm-note'
  li.textContent = text
  return li
}
