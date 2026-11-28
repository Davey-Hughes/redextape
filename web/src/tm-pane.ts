import type { ControlState } from './controls'
import { fieldWidthControl } from './field-width'
import { followedGridPanel } from './followed-grid-panel'
import { n } from './format'
import { MachineViewChrome } from './machine-view-chrome'
import type { PaneEvents } from './pane-chrome'
import { createPanel, type Panel } from './panel'
import { PanelStack, type Shares } from './panel-stack'
import { StateDiagram } from './state-diagram'
import { focusedRows, highlight, linkedRows, StateIndex } from './state-table'
import { resultField, resultRuns, tapeLabel, tapeRows } from './tape'
import type { TmProgram, TmState } from './types'
import { radioGroup } from './view-header'
import type { GridRows, VirtualGrid } from './virtual-grid'
import { DEFAULT_TM_DISPLAY, type TmDisplay } from './workspace'

export { ROW_HEIGHT } from './state-table'
export { OVERSCAN } from './virtual-grid'

/**
 * A tape row's cells with each of `fields`' in a `span.tm-result` box, and when `word` is set the word `result` right
 * after the first, which pushes the rest of the row right. `fields` are ascending and apart.
 */
function withResult(
  cells: readonly HTMLElement[],
  fields: readonly { readonly from: number; readonly to: number }[],
  word: boolean,
): Node[] {
  const out: Node[] = []
  let at = 0
  for (const [i, field] of fields.entries()) {
    const box = document.createElement('span')
    box.className = 'tm-result'
    box.append(...cells.slice(field.from, field.to))
    out.push(...cells.slice(at, field.from), box)
    if (word && i === 0) {
      const said = document.createElement('span')
      said.className = 'result-word'
      said.textContent = 'result'
      out.push(said)
    }
    at = field.to
  }
  return [...out, ...cells.slice(at)]
}

/** Mints each pane's grid a prefix for its cells' ids, which `aria-activedescendant` names. */
let gridsMinted = 0

/**
 * The TM pane: a row per tape, a status line, and the δ function as a virtualized table.
 *
 * EVERY TAPE, NOT ONE. §6.1's mockup shows a single tape; the lowering emits `TAPES = 5` and showing
 * them together is the point — you cannot watch STACK move while REG is read otherwise. A file reduced
 * through the single-tape stage has one tape, and so one row, labelled as the tapes it interleaves.
 *
 * THE TABLE IS VIRTUALIZED BECAUSE `list60` IS 127,881 ROWS (design §3.1).
 */
export class TmPane extends MachineViewChrome {
  #status: HTMLElement
  /**
   * The status line's first row, `state · step · width` (`#drawStatus`), apart from the sentences after it so that
   * only the state name gives way to keep that row whole: an inline box as wide as the line at most, with its state
   * name cut first (the TM width design, decision 25).
   */
  #line: HTMLElement
  /** The current state's name on `#line`, cut with an ellipsis when the row is short of room; its tooltip is whole. */
  #stateName: HTMLElement
  /**
   * Whether the step readout is shown — spec §8's `steps` switch. At `bar` the one step bar reads the steps, and this
   * view's line drops its own, as the header drops its strip.
   */
  #stepsShown = true
  /**
   * The readout as it reads at the run's newest recorded step (`ControlState.stepTextAtNewest`), which `#drawStatus`
   * gives the step part the room of, so the line's rows do not change while a playing run's count gains digits.
   */
  #stepAtNewest = ''
  /** Whether `#frame` is the run's result, whose REG field 0 and HEAP cells the tapes mark: `setResult`. */
  #result = false
  /** Whether the run's fields read least significant digit first, which the status line says beside the result. */
  #littleEndian = false
  /**
   * The status line's `little-endian` part while the result of a binary run shows, else `null`; on the line only
   * while the line has room for it: `#fitEndian`.
   */
  #endian: HTMLElement | null = null
  #tapes: HTMLElement
  /**
   * The pane's own body — everything below the heading row, wrapped in one element for `host.replaceChildren`
   * below.
   */
  #body: HTMLElement
  #program: TmProgram | null = null
  #names: string[] = []
  #frame: TmState | null = null

  /**
   * The rule table: a `VirtualGrid`, whose box is the rules panel's body. This view says what each row shows and does
   * (`#tableRows`); the grid owns the drawn window, the active row, the keys, clicks and following.
   */
  #grid: VirtualGrid
  /**
   * The rule table as a panel (Plan 7 part 1, spec §8): the body is the grid's box, the header action is
   * its re-attach. The panel hides and shows the box and holds whether the table is open (`isOpen`);
   * this class keeps no copy, so a `setOpen` cannot leave one stale. Its `onToggle` redraws.
   */
  #rulesPanel: Panel
  /**
   * The state diagram (Plan 7 part 4 spec §8) and its panel, whose header carries *program | local* and
   * *arcs | chips*, and its own re-attach.
   */
  #diagram: StateDiagram
  #diagramPanel: Panel
  #diagramReattach: HTMLButtonElement
  #edgesChoice: ReturnType<typeof radioGroup>
  #levelChoice: ReturnType<typeof radioGroup>
  /** This view's display settings, and where a change to them is recorded — `LambdaPane`'s pair. */
  #display: TmDisplay
  #onDisplay: ((d: TmDisplay) => void) | undefined
  /** The program's width box, in the view's header; absent where the view was built without a width. */
  #width: ReturnType<typeof fieldWidthControl> | null
  #index: StateIndex | null = null
  #linked: Set<number> = new Set()
  /**
   * The running focus's own rows — a SECOND, INDEPENDENT layer from `#linked` above, mirroring the
   * source pane's "pin and focus are different objects, both may be on screen" split (design §4.3).
   * `#linked` moves on a click; this moves every δ-step. See `setFocus`'s own doc for why it never
   * drives a scroll the way `setLink` can.
   */
  #focused: Set<number> = new Set()

  /**
   * `panels` is the view's stored panel state (`workspace.ts`'s `Panels`), read once here; each panel reports
   * every later toggle through `on.panel`. `display` is its stored display settings, reported through
   * `on.tmDisplay`.
   */
  constructor(
    host: HTMLElement,
    on: PaneEvents,
    panels: { readonly rules?: boolean; readonly diagram?: boolean } = {},
    display: TmDisplay = DEFAULT_TM_DISPLAY,
    sizes: Shares = {},
  ) {
    super(on)
    this.#display = display
    this.#onDisplay = on.tmDisplay
    this.#status = document.createElement('div')
    this.#status.className = 'tm-status'
    // THE WORDS AFTER THE RESULT ARE WEIGHED AGAIN WHEN THE LINE'S WIDTH CHANGES, which no draw follows: a view
    // narrowed with them kept would cut them or the state name, and one widened would not take them back.
    new ResizeObserver(() => this.#fitEndian()).observe(this.#status)
    this.#line = document.createElement('span')
    this.#line.className = 'tm-line'
    this.#stateName = document.createElement('span')
    this.#stateName.className = 'tm-state'
    this.#tapes = document.createElement('div')
    this.#tapes.className = 'tapes'
    // THE READOUT LIVES ON THE STATUS LINE, NEVER IN THE STRIP (`#drawStatus` places it), so the bar holds no text
    // whose width grows with the step count.
    this.steps.step.remove()

    // THE TABLE IS A GRID (spec §9.2, accessibility item 3): one tab stop, one `gridcell` per row, and a roving active
    // row that `aria-activedescendant` names — `VirtualGrid`, whose doc carries the scroll, focus and clamp handling.
    // CLICK A ROW, LIGHT ITS SOURCE: the table is 127,881 rows for `list60` and nothing in it says what any row is
    // FOR; `activate` is the answer to that, for a click and for Enter alike.
    const rules = followedGridPanel({
      name: 'rules',
      label: 'rules',
      open: panels.rules ?? true,
      reattachText: 'follow current rule',
      classes: { box: 'state-table', spacer: 'state-spacer', rows: 'state-rows', row: 'state-row' },
      idPrefix: `tm-grid-${gridsMinted++}`,
      hasContent: () => this.#index !== null,
      rows: () => this.#tableRows(),
      activate: (i) => {
        const row = this.#index?.row(i) ?? null
        if (row !== null) on.linkState?.(row.kind === 'state' ? row.id : row.stateId)
      },
      onToggle: (open) => on.panel?.('rules', open),
    })
    this.#grid = rules.grid
    this.#rulesPanel = rules.panel
    // THE PROGRAM'S WIDTH, ON THE VIEW'S HEADER BAR (the TM width design, decision 24): it sizes the whole machine the
    // view shows, not one panel of it. AT THE BAR'S END, RIGHT BEFORE `⋯` (decision 27): the first of the view's own
    // actions, as `LambdaPane`'s re-attach is, so it keeps `⋯`'s gap and order, and the Tab order follows the bar.
    // Prepended, so it is first whether or not `viewMenu` has mounted `⋯` yet, which it puts after the view's own.
    this.#width = on.fieldWidth === undefined ? null : fieldWidthControl(on.fieldWidth)
    if (this.#width !== null) this.header.actions.prepend(this.#width.el)

    // THE STATE DIAGRAM (Plan 7 part 4 spec §8): a panel beside the rules, open by default since it is the view's
    // map of the machine, with *program | local* and *arcs | chips* (Plan 7 part 4 spec amendment 11) among its
    // header actions and a re-attach of its own: following is per surface, and a scroll in one must not detach
    // the other.
    this.#diagram = new StateDiagram({
      link: (state) => on.linkState?.(state),
      moved: () => this.#syncDiagramReattach(),
      showStates: () => this.#setDisplay({ ...this.#display, level: 'local' }),
    })
    this.#diagram.setEdges(display.edges)
    this.#diagram.setLevel(display.level)
    this.#diagramReattach = document.createElement('button')
    this.#diagramReattach.type = 'button'
    this.#diagramReattach.className = 'diagram-reattach'
    this.#diagramReattach.textContent = 'follow current state'
    this.#diagramReattach.hidden = true
    this.#diagramReattach.addEventListener('click', () => {
      const had = document.activeElement === this.#diagramReattach
      this.#diagram.attach()
      this.#syncDiagramReattach()
      if (had && this.#diagramReattach.hidden) this.#diagramPanel.toggle.focus()
    })
    this.#levelChoice = radioGroup(
      {
        label: 'level',
        choices: [
          { value: 'program', label: 'program' },
          {
            value: 'local',
            label: 'local',
            hint: () => (this.#diagram.shown === 'local' ? 'press again to reset the view' : null),
          },
        ],
        current: () => this.#diagram.shown,
        pick: (v) => {
          // *LOCAL* PRESSED WHILE IT SHOWS PUTS IT BACK (`StateDiagram.resetLocal`), read before the pick: a press that
          // brings it in from the program level keeps the zoom; the change of level centres the current state.
          const again = v === 'local' && this.#diagram.shown === 'local'
          this.#setDisplay({ ...this.#display, level: v === 'local' ? 'local' : 'program' })
          if (again) this.#diagram.resetLocal()
        },
      },
      'diagram-mode',
    )
    // *ARCS | CHIPS* DISABLED WITH ITS REASON WHERE IT CANNOT APPLY (umbrella rule 4): the edges' two renderings are
    // the program level's.
    this.#edgesChoice = radioGroup(
      {
        label: 'edges',
        choices: [
          { value: 'arcs', label: 'arcs' },
          { value: 'chips', label: 'chips' },
        ],
        current: () => this.#display.edges,
        pick: (v) => this.#setDisplay({ ...this.#display, edges: v === 'chips' ? 'chips' : 'arcs' }),
        disabled: () => (this.#diagram.shown === 'local' ? 'arcs and chips draw the program level' : null),
      },
      'diagram-mode',
    )
    this.#diagramPanel = createPanel({
      name: 'diagram',
      label: 'state diagram',
      body: this.#diagram.el,
      open: panels.diagram ?? true,
      onToggle: (open) => {
        this.#diagram.redraw()
        this.#syncDiagramReattach()
        on.panel?.('diagram', open)
      },
      onDrawn: () => {
        this.#diagram.redraw()
        this.#syncDiagramReattach()
      },
    })
    this.#diagramPanel.actions.append(this.#diagramReattach, this.#levelChoice.el, this.#edgesChoice.el)

    // `#body` CARRIES EVERYTHING BELOW THE HEADING: the status line, the tapes, the rules and the state diagram. The
    // line comes first because it holds the step count the bar's step buttons move (the TM width design, decision 26).
    this.#body = document.createElement('div')
    this.#body.className = 'tm-pane'
    this.#body.append(this.#status, this.#tapes, this.#rulesPanel.el, this.#diagramPanel.el)
    this.mount(host, this.#body)
    // THE REGIONS THAT SHARE THE VIEW'S HEIGHT (the view layouts spec §11.1), top to bottom. The rules take two
    // shares and the diagram one.
    // IT KEEPS ITSELF: its listeners are on the regions and their headers, and nothing here reads it again.
    new PanelStack(
      [
        {
          name: 'rules',
          label: 'rules',
          el: this.#rulesPanel.el,
          share: 2,
          panels: [this.#rulesPanel],
          bodies: () => [this.#rulesPanel.body],
        },
        {
          name: 'diagram',
          label: 'state diagram',
          el: this.#diagramPanel.el,
          share: 1,
          panels: [this.#diagramPanel],
          bodies: () => [this.#diagramPanel.body],
        },
      ],
      sizes,
      (next) => on.panelSizes?.(next),
    )
  }

  /**
   * Set once per compile. `TmProgram` does not change as the cursor moves, which is what the
   * `TmProgram`/`TmState` split exists for.
   */
  setProgram(p: TmProgram | null, names: string[]): void {
    this.#program = p
    this.#names = names
    this.#index = p === null ? null : new StateIndex(p)
    // A new compile invalidates every state id — the block a stale link named may no longer exist,
    // or may now name something else entirely.
    this.#linked = new Set()
    this.#focused = new Set()
    // The first row active, following on, and the table at the top — `VirtualGrid.reset`'s doc says why its
    // scroll is recorded before it is written.
    this.#grid.reset()
    this.#frame = null
    this.#drawTable()
    this.#diagram.setProgram(p, names)
    this.#levelChoice.sync()
    this.#edgesChoice.sync()
    this.#syncDiagramReattach()
  }

  /** Record a changed display, draw it, and report it for the workspace — `LambdaPane.#setDisplay`'s shape. */
  #setDisplay(d: TmDisplay): void {
    this.#display = d
    this.#diagram.setEdges(d.edges)
    this.#diagram.setLevel(d.level)
    this.#levelChoice.sync()
    this.#edgesChoice.sync()
    this.#syncDiagramReattach()
    this.#onDisplay?.(d)
  }

  /**
   * The diagram's re-attach exists only while it does something, as the rules panel's does: hidden while the
   * diagram follows, and while its panel is closed.
   */
  #syncDiagramReattach(): void {
    this.#diagramReattach.hidden = this.#diagram.following || !this.#diagramPanel.isOpen()
  }

  /**
   * Highlight a link's state block, optionally scrolling to it.
   *
   * `scrollTo` IS FALSE WHEN THE CLICK CAME FROM THIS TABLE. Scrolling a list the user just clicked
   * in moves the row out from under their cursor; the caller knows where the gesture came from and
   * this does not have to guess.
   *
   * THE SCROLL DOES NOT TOUCH FOLLOWING. Following is about the machine's current state, and a link is
   * about a construct; `VirtualGrid.scrollToRow` records the link's row as a target the next draw writes
   * over the follow target and holds until the machine moves — 5b design §5.1 — and its doc says why writing
   * `scrollTop` here instead would be reverted the instant following is on, which is the default state on
   * every fresh compile.
   *
   * "UNTIL THE MACHINE MOVES" NAMES THE STEP, NOT THE ROW (Plan 7 part 5 spec amendment 21). The hold is keyed
   * on `#tableRows`'s `frame` — this pane's `#frame.step` — because the row above, the current state's own
   * header, is exactly the one row a self-looping step leaves in place, so a hold keyed on that row instead
   * would outlive such a step, which a compiled machine takes often.
   *
   * **A PIN WITH NO ROWS HERE RELEASES THE HOLD** (`VirtualGrid.release`): a pin cleared, or moved to a construct
   * with no states, leaves nothing for the table to be parked on, and an earlier link's hold would otherwise keep
   * it on a block no longer marked until the machine moved — for good, once the run had ended. A click in this
   * table passes `scrollTo` false and so leaves the table where it was clicked, as it leaves a scroll.
   */
  setLink(states: number[], scrollTo: boolean): void {
    this.#linked = this.#index === null ? new Set() : linkedRows(this.#index, states)
    this.#diagram.setLinked(states)
    if (scrollTo) {
      const first = [...this.#linked].sort((a, b) => a - b)[0]
      if (first === undefined) this.#grid.release()
      else this.#grid.scrollToRow(first)
    }
    this.#drawTable()
  }

  /**
   * Highlight the running focus's own block: the state header (never the rules — `focusedRows`'s own
   * doc says why) of every state `states` names.
   *
   * NO `scrollTo`, UNLIKE `setLink`. A link's scroll is a direct user gesture, and it holds over the follow
   * target until the machine moves (`setLink`'s own doc, 5b design §5.1, Plan 7 part 5 spec amendment 21); the
   * running focus moves on its own, every δ-step, with no gesture behind it — scrolling to it every time it moved
   * would fight `Follow`'s own scroll for the CURRENT row, which already runs in every `#drawTable` no link holds.
   * The caller passes `states: number[]`, already resolved through `LinkIndex.linkFor` — this class never
   * imports `LinkIndex`, matching `setLink`'s own boundary.
   *
   * **A PURE SETTER — IT DOES NOT DRAW, AND THAT ASYMMETRY WITH `setLink` IS THE POINT.** `setLink` has
   * to draw because a click reaches it with no `render` behind it. This one is only ever called on a
   * path where a `#drawTable` is already about to run for another reason, and drawing here too would make
   * that TWO full table rebuilds per rendered frame: the `draw()` that `draw.ts`'s `createDraw` builds runs
   * `render(...)` — which draws unconditionally — on every recorded frame during playback, so the first pass
   * would build its rows against the PREVIOUS frame's `#focused` and throw them away microseconds later. Its
   * caller orders itself so a draw follows: `draw()` calls this BEFORE `render(...)`. Move that call after its
   * draw and the focus silently lags one frame.
   *
   * THAT ORDERING IS GATED, NOT MERELY DOCUMENTED: `running-focus.test.ts`'s `lights the δ-table block the
   * machine is running inside, and nothing when it is inside none` fails if `draw()`'s call moves below the
   * view's render.
   */
  setFocus(states: number[]): void {
    this.#focused = this.#index === null ? new Set() : focusedRows(this.#index, states)
  }

  /**
   * `LinkedPane`'s word of the run's result: at it the next `render` boxes REG's field 0 with the word `result` after
   * it and a list's cells on HEAP, and the status line says `little-endian` where `littleEndian` says the run's fields
   * read so. A pure setter, for `setFocus`'s reason.
   */
  setResult(on: boolean, littleEndian: boolean): void {
    this.#result = on
    this.#littleEndian = littleEndian
  }

  /** Spec §8's `steps` switch, per `PaneView.setStepsShown` — the view's header owns the slot. */
  override setStepsShown(shown: boolean): void {
    super.setStepsShown(shown)
    if (shown === this.#stepsShown) return
    this.#stepsShown = shown
    this.#drawStatus()
  }

  render(frame: TmState | null, controls: ControlState, before: TmState | null = null): void {
    this.#frame = frame
    this.steps.update(controls)
    this.#stepAtNewest = controls.stepTextAtNewest
    this.#width?.sync()
    this.#diagram.render(this.#program === null ? null : frame, before)
    this.#syncDiagramReattach()
    if (frame === null || this.#program === null) {
      this.#drawStatus()
      this.#tapes.replaceChildren()
      this.#drawTable()
      return
    }

    this.#drawStatus()

    const field = this.#result ? resultField(frame) : null
    // A list result's cells on HEAP, found by the name the core gives the tape, lit where the window shows them; the
    // word stays on REG's field 0.
    const heap = this.#names.indexOf('HEAP')
    const runs = this.#result ? resultRuns(frame, heap) : []
    this.#tapes.replaceChildren(
      ...tapeRows(frame, this.#names).map((row, tape) => {
        const el = document.createElement('div')
        el.className = 'tape'
        // A LABELLED GROUP (spec §9.3): where the head is and what it reads, said when a reader reaches the row.
        el.setAttribute('role', 'group')
        el.setAttribute('aria-label', tapeLabel(row))
        const label = document.createElement('span')
        label.className = 'tape-label'
        label.textContent = row.label
        const cells = document.createElement('span')
        cells.className = 'cells'
        const drawn = row.cells.map((c, i) => {
          const cell = document.createElement('span')
          cell.className = i === row.headIndex && row.headInWindow ? 'cell head' : 'cell'
          cell.textContent = c
          return cell
        })
        const lit = tape === 0 ? (field === null ? [] : [field]) : tape === heap ? runs : []
        cells.append(...(lit.length > 0 ? withResult(drawn, lit, tape === 0) : drawn))
        if (tape === heap && runs.length > 0) el.setAttribute('aria-description', 'the result’s cells marked')
        el.append(label, cells)
        return el
      }),
    )

    this.#drawTable()
  }

  /**
   * The one writer of `#status`. Composes two independent parts:
   *
   *   * THE PER-FRAME PARTS — the state's name and `` `width ${n(width)}` `` — absent whenever there is no frame or
   *     no program to name a state in, the condition `render`'s own frame-null branch tests.
   *   * THE STEP READOUT between them (`stepControls`' `step`), alone before the first frame, as the strip shows it,
   *     and absent while the `steps` switch puts the steps on the one bar (`#stepsShown`).
   */
  #drawStatus(): void {
    const frame = this.#frame
    const program = this.#program
    const named = frame !== null && program !== null
    // EACH PART AFTER THE FIRST CARRIES ITS OWN ` · `, so that a part the row cannot fit takes its separator to the
    // next row with it rather than leaving one hanging at the end of this one.
    // A RESERVED PART TAKES THE ROOM `reserve` WOULD, whatever it shows (`.tm-reserved` in `style.css`): the shown
    // content in a box of its own, and `reserve` beside it as generated content, so it is neither in the line's text
    // nor read out.
    const parts: Node[] = []
    const part = (content: string | Node, reserve?: string): HTMLElement => {
      const lead = parts.length === 0 ? [] : [' · ']
      const el = document.createElement('span')
      el.className = 'tm-part'
      if (reserve === undefined) el.append(...lead, content)
      else {
        const shown = document.createElement('span')
        shown.className = 'tm-shown'
        shown.append(...lead, content)
        el.classList.add('tm-reserved')
        el.dataset.reserve = [...lead, reserve].join('')
        el.append(shown)
      }
      parts.push(el)
      return el
    }
    if (named) {
      // A `StateId` past the end yields no name rather than an index nobody can read — the same
      // no-fallback rule `TmState::source_node` follows one layer in.
      const name = program.states[frame.state]?.name ?? `state ${frame.state}`
      this.#stateName.textContent = name
      this.#stateName.title = name
      parts.push(this.#stateName)
    }
    if (this.#stepsShown && this.steps.step.textContent !== '') part(this.steps.step, this.#stepAtNewest)
    if (named) part(`width ${n(program.width)}`)
    this.#endian = named && this.#result && this.#littleEndian ? part('little-endian') : null
    this.#endian?.classList.add('tm-endian')
    this.#line.replaceChildren(...parts)
    this.#status.replaceChildren(...(parts.length === 0 ? [] : [this.#line]))
    this.#fitEndian()
  }

  /**
   * Keep the status line's `little-endian` only where the line has room for it: drawn whole, and the state name no
   * more cut than without it. **DROPPED, NEVER WRAPPED** (the return-value highlight design, *TM*): a line that gained
   * a row would move the tapes under it, at the one step the words are said. `.tm-endian` takes only the room the
   * line's other parts leave (`style.css`), so the line's height is the same with the words or without them, and a
   * change of width that drops them changes no size the status line's observer watches.
   */
  #fitEndian(): void {
    const endian = this.#endian
    if (endian === null) return
    endian.remove()
    const name = this.#stateName.getBoundingClientRect().width
    this.#line.append(endian)
    const cut = endian.scrollWidth > endian.clientWidth
    if (cut || this.#stateName.getBoundingClientRect().width < name - 0.5) endian.remove()
  }

  /**
   * Draw the rule table: `VirtualGrid.draw`, with this view's rows (`#tableRows`). The grid also draws on its own for
   * a scroll, a resize, a key and a click; this is the draw for everything the grid cannot see change — a frame, a
   * program, a link.
   */
  #drawTable(): void {
    this.#grid.draw()
  }

  /**
   * The rule table's rows for one draw: one per state and one per rule (`StateIndex`), the current state's row as
   * the one following keeps centred, and each row's text and marks.
   */
  #tableRows(): GridRows {
    const index = this.#index
    if (index === null) return { count: null, follow: null, frame: null, fill: () => {} }
    const marks = highlight(index, this.#frame)
    return {
      count: index.rowCount,
      follow: marks === null ? null : marks.stateRow,
      // THE STEP THIS DRAW SHOWS, NOT WHETHER THE FOLLOWED ROW MOVED. `VirtualGrid`'s link hold keys on
      // this (`GridRows.frame`'s own doc, Plan 7 part 5 spec amendment 21): the row above is the CURRENT STATE's
      // header, which a step that loops in its own state — the ordinary case in a compiled machine — leaves
      // unchanged, so a hold keyed on that row alone would never release.
      frame: this.#frame?.step ?? null,
      fill: (i, el, text) => {
        const row = index.row(i)
        if (row === null) return
        text.className = 'state-cell'
        if (row.kind === 'state') {
          el.classList.add('is-state')
          if (row.accept) el.classList.add('is-accept')
          text.textContent = row.name
        } else {
          el.classList.add('is-rule')
          const cell = (v: string | null) => v ?? '*'
          text.textContent = `[${row.read.map(cell).join(' ')}] → [${row.write.map(cell).join(' ')}] ${row.moves.join(' ')} → ${
            this.#program?.states[row.next]?.name ?? row.next
          }`
        }
        // THE CURRENT STATE IS SAID, NOT ONLY SHADED (spec §9.3, accessibility item 4); the next rule's words are
        // generated content (`style.css`'s `.state-cell[data-marks]`), so they are read and are not the row's text.
        if (marks !== null && i === marks.stateRow) {
          el.classList.add('is-current')
          el.setAttribute('aria-current', 'step')
        }
        if (marks !== null && i === marks.ruleRow) {
          el.classList.add('is-next')
          text.dataset.marks = 'fires next'
        }
        if (this.#linked.has(i)) el.classList.add('is-linked')
        if (this.#focused.has(i)) el.classList.add('is-focus')
      },
    }
  }
}
