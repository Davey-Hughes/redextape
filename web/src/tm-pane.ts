import type { ControlState } from './controls'
import { CopyEditor } from './copy-editor'
import type { EditablePane } from './editor-custody'
import { n } from './format'
import type { Dir } from './layout'
import type { PaneChoice, PaneEvents, SplitChoices } from './pane-chrome'
import { createPanel, type Panel } from './panel'
import type { Leg } from './protocol'
import { valueLine } from './results'
import type { ScratchEditor } from './scratch-editor'
import type { Binding, PaneOption } from './sessions'
import { StateDiagram } from './state-diagram'
import { focusedRows, highlight, linkedRows, StateIndex } from './state-table'
import { stepControls } from './step-controls'
import { tapeLabel, tapeRows } from './tape'
import type { TmProgram, TmScratchStatus, TmState, ValueReading } from './types'
import { radioGroup, type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
import { type GridRows, VirtualGrid } from './virtual-grid'
import { DEFAULT_TM_DISPLAY, type TmDisplay } from './workspace'

export { ROW_HEIGHT } from './state-table'
export { OVERSCAN } from './virtual-grid'

/** Mints each pane's grid a prefix for its cells' ids, which `aria-activedescendant` names. */
let gridsMinted = 0

/**
 * The TM pane: a row per tape, a status line, a value line for a headered TM buffer, and the δ function as a
 * virtualized table.
 *
 * EVERY TAPE, NOT ONE. §6.1's mockup shows a single tape; the lowering emits `TAPES = 5` and showing
 * them together is the point — you cannot watch STACK move while REG is read otherwise. A file reduced
 * through the single-tape stage has one tape, and so one row, labelled as the tapes it interleaves.
 *
 * THE TABLE IS VIRTUALIZED BECAUSE `list60` IS 127,881 ROWS (design §3.1). The `[1, 2]` fixture's 455
 * rows, which sized this feature until it was measured, is 0.4% of that.
 *
 * **`implements EditablePane`, THE SECOND CLASS TO CARRY THE CLAUSE.** `LambdaPane`'s own doc records why it is
 * load-bearing rather than decorative: `editor-custody.ts`'s cast to `EditablePane` goes through `unknown` of
 * necessity, so without this clause `tsc` verifies nothing about whether this class actually satisfies the shape
 * custody casts to — a renamed method would pass silently. The members below (`setEditor`, `takeEditor`,
 * `receiveEditor`, `holdsEditor`, `flushEditor`) hand off to `#copy`, the `CopyEditor` this view shares with the asm
 * view, which carries the clause too and holds the reasons behind each.
 */
export class TmPane implements EditablePane {
  #status: HTMLElement
  #tapes: HTMLElement
  #steps: ReturnType<typeof stepControls>
  /** The view's header — `LambdaPane`'s `#header`, the same component. */
  #header: ViewHeader
  /**
   * A copy's editor, its text panel and outline, and the facts behind *format* and *edit a copy* — the part this view
   * shares with the asm view (`copy-editor.ts`), whose comments carry the reasons behind the handoff's review fixes.
   */
  #copy: CopyEditor
  /**
   * The pane's own body — everything below the heading row, wrapped in one element for `host.replaceChildren`
   * below.
   *
   * **THE COLLAPSE IS NO LONGER A FACT ABOUT THIS ELEMENT, WHICH REVERSES WHAT THIS DOC USED TO SAY —
   * Plan 7 part 1.** It used to carry a `.collapsed` class of its own, read by an ancestor
   * selector in `style.css` so the tape rows and δ-table stayed outside the thing the toggle named. The
   * text panel (`CopyEditor.textPanel`) wraps the copy editor's host directly and hides it with `hidden`
   * instead — the same mechanism `LambdaPane` uses — so `#body` carries no class for this at all, and
   * `#drawTable`'s own independence from a collapse now follows from that host being a child of the
   * text panel section, itself a sibling `#drawTable` never touches, rather than from which element the
   * class landed on.
   */
  #body: HTMLElement
  /**
   * What this pane's split menus offer — `LambdaPane.#choices`'s twin, and its doc carries the argument
   * for the starting value and for reading it through a thunk rather than handing a list over once.
   */
  #choices: SplitChoices = { options: [], sourceAvailable: false, current: null }
  #program: TmProgram | null = null
  #names: string[] = []
  #frame: TmState | null = null
  /**
   * The last `TmScratchStatus` a `tm-scratch-compiled` reply carried, or `null` on an attached pane —
   * `#drawStatus`'s other input, alongside `#frame`/`#program`. See `setScratchStatus`'s doc for why
   * this is stored rather than written straight to `#status`: this class has THREE writers of that one
   * element's text (this field's setter, and both branches of `render`), and composing them at one
   * private writer is what stops whichever runs last from erasing what the other two years said.
   *
   * **CLEARED ON `setEditor(null)`, NOT ONLY SET IN `setScratchStatus`** — by the `onUnmount` this view hands
   * `#copy`. (`takeEditor()` cleared it too until a take could leave the pane on the copy — *move the editor here* —
   * and `CopyEditor.takeEditor`'s doc has why it no longer does.) A pane rebound off the scratch it was reporting for
   * must stop narrating that scratch's header — the same "fabricated state" class of defect `LambdaPane.setDetached`'s
   * own doc records finding, pointed the other way: there the bug was an editor outliving the fact that made it
   * appear, here it would be a sentence outliving the editor it describes.
   *
   * **THAT CLEAR REACHES ONLY THE PANE HOLDING THE EDITOR, AND A BUFFER'S STATUS REACHES EVERY PANE ON IT —
   * Important finding, whole-branch review of the reduced-files slice.** `replies.ts` fans the status out to every
   * TM pane on the session and `pane-host.ts` seeds a new one from the entry, so a split pane that never held the
   * editor kept `reduced: single-tape · 241,666 steps` and `value: 2` after being rebound to source, and kept a
   * running count after its buffer was cooled. More clears follow the session instead of the editor: `pane-host.ts`
   * reseeds the pane from the session it moves onto, through its selector (the same-leg `rebind` arm) or by a
   * buffer's cool or retire (`reseedingSlots`), `setDetached(false)` clears on any route back to source, and
   * `replies.ts`'s `worker-error` arm tells every pane on the buffer.
   */
  #scratch: TmScratchStatus | null = null
  /**
   * The value run's latest reading, or `null` before its first report and for a file with no header.
   *
   * **SHOWN ONLY WHILE `#scratch` IS SET.** Every caller that sets a status sets a reading with it (`replies.ts`'s
   * `tm-scratch-compiled` arm, `pane-host.ts`'s seeding), so a reading can never outlive the status it was reported
   * under onto the screen. The clears that follow the session (`#scratch`'s doc) clear both, because each of them
   * stands for a session change, after which a seed or a reply sets both again.
   */
  #reading: ValueReading | null = null
  /**
   * The value line. **`role="status"` FROM CONSTRUCTION**, because it updates while nobody is looking at it, which
   * is the one kind of text the accessibility list's item 6 (`#link-status`) found announcing nothing.
   *
   * **EMPTY RATHER THAN `hidden` WHEN IT HAS NOTHING TO SAY, AND `aria-busy="true"` WHILE ITS RUN IS `Running`** — the
   * project owner's decision on the whole-branch review of the reduced-files slice. A live region is announced from
   * the accessibility tree, and `hidden` takes the element out of it, so a line that is unhidden in the same write
   * that fills it can be missed. While the run is going the line changes after every `VALUE_CHUNK`, and a region that
   * announced each count would talk over everything else; `aria-busy` holds the announcements until the run ends,
   * and removing it announces the settled value once. `style.css` keeps the empty line from taking vertical space.
   */
  #value: HTMLElement

  /**
   * The view's `⋯` menu and `✕` — `LambdaPane.#menu`'s twin. `edit a copy` is **BUILT ONLY WHEN THE
   * HANDLER EXISTS**, for that field's own reason: a caller with no `detachMachine` gets a view with no
   * copy offered rather than one that offers a copy and swallows it. *Move the editor here* likewise, for
   * `PaneEvents.showEditor`. `#copy` keeps *format*, *edit a copy* and *move the editor here* in step.
   */
  #menu: ViewMenu

  /**
   * The rule table: a `VirtualGrid`, whose box is the rules panel's body. This view says what each row shows and does
   * (`#tableRows`); the grid owns the drawn window, the active row, the keys, clicks and following.
   */
  #grid: VirtualGrid
  /**
   * The rule table as a panel (Plan 7 part 1, spec §8): the body is the grid's box, the header action is
   * `#reattach`. The panel hides and shows the box and holds whether the table is open (`isOpen`);
   * this class keeps no copy, so a `setOpen` cannot leave one stale. Its `onToggle` redraws.
   */
  #rulesPanel: Panel
  /**
   * The state diagram (spec §8) and its panel, whose header carries *program | local* and *arcs | chips*, and its
   * own re-attach.
   */
  #diagram: StateDiagram
  #diagramPanel: Panel
  #diagramReattach: HTMLButtonElement
  #edgesChoice: ReturnType<typeof radioGroup>
  #levelChoice: ReturnType<typeof radioGroup>
  /** This view's display settings, and where a change to them is recorded — `LambdaPane`'s pair. */
  #display: TmDisplay
  #onDisplay: ((d: TmDisplay) => void) | undefined
  #reattach: HTMLButtonElement
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
    panels: { readonly rules?: boolean; readonly diagram?: boolean; readonly outline?: boolean } = {},
    display: TmDisplay = DEFAULT_TM_DISPLAY,
  ) {
    this.#display = display
    this.#onDisplay = on.tmDisplay
    this.#header = viewHeader(on.rebind)
    this.#status = document.createElement('div')
    this.#status.className = 'tm-status'
    this.#value = document.createElement('div')
    this.#value.className = 'tm-value'
    this.#value.setAttribute('role', 'status')
    this.#tapes = document.createElement('div')
    this.#tapes.className = 'tapes'
    this.#steps = stepControls(on)
    // `detachMachine` carries no argument (`PaneEvents.detachMachine`'s own doc: a machine has no step-k
    // text to report), so the item's run is the handler itself rather than a closure over a frame.
    const detachMachine = on.detachMachine
    this.#menu = viewMenu(this.#header.actions, {
      // REMOVED WHERE THERE IS NO EDITOR, not disabled: a view showing a running leg has no
      // document to format, which is the umbrella's rule for a control that cannot apply.
      format: () => this.#copy.format(),
      ...(on.splitRow !== undefined && on.splitColumn !== undefined
        ? { split: (dir: Dir, c: PaneChoice) => (dir === 'row' ? on.splitRow?.(c) : on.splitColumn?.(c)) }
        : {}),
      ...(on.close !== undefined ? { close: on.close } : {}),
      ...(detachMachine !== undefined ? { editCopy: { run: detachMachine, what: 'the whole machine' } } : {}),
      ...(on.showEditor !== undefined ? { claim: on.showEditor } : {}),
      choices: () => this.#choices,
    })
    // THE COPY'S EDITOR, TEXT PANEL AND OUTLINE, AND THE MENU'S *FORMAT* AND *EDIT A COPY* (`copy-editor.ts`).
    //
    // **A TM VIEW'S OUTLINE IS ITS STATES** — measured against the real server, which answers a `state` block per
    // symbol at kind 5. Closed by default, like the source view's: a machine of 1,199 states is the ordinary case, and
    // a list of them above the tapes is not what a reader opened a TM view to see.
    this.#copy = new CopyEditor(on, {
      menu: this.#menu,
      outlineOpen: panels.outline ?? false,
      noun: 'rules',
      // THE SCRATCH STATUS GOES WITH THE EDITOR'S UNMOUNT — see `#scratch`'s own doc. Cleared on the unmount rather
      // than left for whatever `render` happens next, because a caller reading `host.textContent` between the unmount
      // and the next frame must not see a sentence about a machine this pane no longer shows. Not on `takeEditor`: a
      // pane that gives its editor to another view of the copy still shows the copy (`CopyEditor.takeEditor`'s doc).
      onUnmount: () => {
        this.#scratch = null
        this.#drawStatus()
        this.#drawValue()
      },
    })

    // ADDED AND REMOVED, NEVER DISABLED — same idiom `pane-chrome.ts` states for the continue button.
    // A reattach only does something while the table is detached, so it exists only then; the grid's
    // `beforeDraw`, below, keeps `hidden` in sync every frame and every scroll, the one place both happen.
    this.#reattach = document.createElement('button')
    this.#reattach.type = 'button'
    this.#reattach.className = 'table-reattach'
    this.#reattach.textContent = 'follow current rule'
    this.#reattach.hidden = true
    this.#reattach.addEventListener('click', () => {
      const had = document.activeElement === this.#reattach
      // Follows and redraws now, not at the next step — otherwise the current row stays wherever the manual
      // scroll left it until the machine happens to advance.
      this.#grid.attach()
      // THE BUTTON HIDES ITSELF — the draw sets `#reattach.hidden` once the table follows again — AND
      // MUST NOT TAKE THE FOCUS WITH IT (spec §11): the rules panel's toggle, beside it, takes it.
      if (had && this.#reattach.hidden) this.#rulesPanel.toggle.focus()
    })

    // THE TABLE IS A GRID (spec §9.2, accessibility item 3): one tab stop, one `gridcell` per row, and a roving active
    // row that `aria-activedescendant` names — `VirtualGrid`, whose doc carries the scroll, focus and clamp handling
    // this table's reviews found. CLICK A ROW, LIGHT ITS SOURCE: the table is 127,881 rows for `list60` and nothing
    // in it says what any row is FOR; `activate` is the answer to that, for a click and for Enter alike.
    this.#grid = new VirtualGrid({
      classes: { box: 'state-table', spacer: 'state-spacer', rows: 'state-rows', row: 'state-row' },
      idPrefix: `tm-grid-${gridsMinted++}`,
      isOpen: () => this.#rulesPanel.isOpen(),
      rows: () => this.#tableRows(),
      activate: (i) => {
        const row = this.#index?.row(i) ?? null
        if (row !== null) on.linkState?.(row.kind === 'state' ? row.id : row.stateId)
      },
      // KEPT IN SYNC HERE, not in the click handlers, because a draw is the one thing that runs on every frame AND
      // every scroll — the two ways following can change. Hidden with no program at all (reattaching means nothing
      // against an empty table) and while the table is closed, where the button would offer to reposition something
      // nobody can see — the same idiom the control itself follows, which exists so a control is present only when
      // it does something.
      beforeDraw: () => {
        this.#reattach.hidden = this.#index === null || this.#grid.following || !this.#rulesPanel.isOpen()
      },
    })

    // THE RULE TABLE IS A PANEL. `panel.ts` hides the grid's box itself and carries the state in
    // `aria-expanded` rather than relabelling — accessibility item 2 — and keeps the box's `grid` role, labelled
    // by the panel's own toggle. `follow current rule` rides in the panel's header, beside the thing it acts on.
    //
    // REDRAW IN BOTH DIRECTIONS, and the closing one is not symmetry for its own sake. A draw is where
    // `#reattach.hidden` is maintained, so skipping it on the way down left a live "follow" button
    // over a table that is not on screen — the idiom's own rule broken, and the closed-table term written
    // for it could never fire because the draw, where it is evaluated, did not run. Reopening matters
    // for a different reason: a hidden box has `clientHeight` 0, so any step taken while the table was
    // closed computed its scroll target against a zero-height viewport and left the head parked off
    // centre until some later step happened to recentre it.
    this.#rulesPanel = createPanel({
      name: 'rules',
      label: 'rules',
      body: this.#grid.el,
      open: panels.rules ?? true,
      onToggle: (open) => {
        this.#drawTable()
        on.panel?.('rules', open)
      },
    })
    this.#rulesPanel.actions.append(this.#reattach)

    // THE STATE DIAGRAM (spec §8): a panel beside the rules, open by default since it is the view's map of the
    // machine, with *program | local* and *arcs | chips* (amendment 11) among its header actions and a
    // re-attach of its own, for the rule table's reason: following is per surface, and a scroll in one
    // must not detach the other.
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
    // *PROGRAM | LOCAL* AND *ARCS | CHIPS*, EACH DISABLED WITH ITS REASON WHERE IT CANNOT APPLY (umbrella rule 4): a
    // machine with neither instructions nor dotted names has no program level (§7's third tier), and the edges'
    // two renderings are the program level's.
    this.#levelChoice = radioGroup(
      {
        label: 'level',
        choices: [
          {
            value: 'program',
            label: 'program',
            disabled: () =>
              this.#diagram.tier === 'none' && this.#program !== null
                ? 'this machine has no program level: its states carry no instruction and no dotted name to group by'
                : null,
          },
          { value: 'local', label: 'local' },
        ],
        current: () => this.#diagram.shown,
        pick: (v) => this.#setDisplay({ ...this.#display, level: v === 'local' ? 'local' : 'program' }),
      },
      'diagram-mode',
    )
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
    })
    this.#diagramPanel.actions.append(this.#diagramReattach, this.#levelChoice.el, this.#edgesChoice.el)

    // `#body` CARRIES EVERYTHING BELOW THE HEADING, WITH THE TEXT PANEL FIRST — design §4.1's "editor
    // region above, today's tape rows and δ-table below". An attached pane (no editor mounted) is
    // unchanged: the panel starts `hidden` and contributes no box to the flow, so this reordering is
    // invisible until `setEditor` gives it something to show.
    this.#body = document.createElement('div')
    this.#body.className = 'tm-pane'
    this.#body.append(
      this.#copy.textPanel,
      this.#status,
      this.#value,
      this.#tapes,
      this.#rulesPanel.el,
      this.#diagramPanel.el,
      this.#copy.outline,
    )
    this.#header.steps.append(this.#steps.el)
    host.replaceChildren(this.#header.el, this.#body)
  }

  /**
   * Set once per compile. `TmProgram` is ~123 states for `let x = 40; x + 2` and does not change as
   * the cursor moves, which is what the `TmProgram`/`TmState` split exists for.
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
   * over the follow target and holds until the machine moves — design §5.1 — and its doc says why writing
   * `scrollTop` here instead was reverted the instant following was on, which is the default state on every
   * fresh compile.
   *
   * "UNTIL THE MACHINE MOVES" NAMES THE STEP, NOT THE ROW (amendment 21). The hold is keyed on `#tableRows`'s
   * `frame` — this pane's `#frame.step` — because the row above, the current state's own header, is exactly
   * the one row a self-looping step leaves in place, so a hold keyed on that row instead would outlive such a
   * step, which a compiled machine takes often.
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
   * target until the machine moves (`setLink`'s own doc, design §5.1, amendment 21); the running focus moves on
   * its own, every δ-step, with no gesture behind it — scrolling to it every time it moved would fight
   * `Follow`'s own scroll for the CURRENT row, which already runs in every `#drawTable` no link holds. The
   * caller passes `states: number[]`, already resolved through `LinkIndex.linkFor` — this class never
   * imports `LinkIndex`, matching `setLink`'s own boundary.
   *
   * **A PURE SETTER — IT DOES NOT DRAW, AND THAT ASYMMETRY WITH `setLink` IS THE POINT.** `setLink` has
   * to draw because a click reaches it with no `render` behind it. This one is only ever called on a
   * path where a `#drawTable` is already about to run for another reason, and calling it here too made
   * that TWO full table rebuilds per rendered frame: `main.ts`'s `draw()` runs `render(...)` — which
   * draws unconditionally — on every recorded frame during playback, so the first pass built ~40 rows
   * against the PREVIOUS frame's `#focused` and threw them away microseconds later. Both callers order
   * themselves so a draw follows: `draw()` calls this BEFORE `render(...)`, and the keystroke handler
   * calls it before `setLink([], false)`. Move either call after its draw and the focus silently lags
   * one frame.
   *
   * THAT ORDERING IS GATED, NOT MERELY DOCUMENTED. `running-focus.test.ts`'s `lights the δ-table block
   * the machine is running inside` fails under exactly that mutation — verified by moving `draw()`'s
   * call below `tmPane.render(...)` and rerunning: the table reports the PREVIOUS frame's focus (`[]`
   * where `['pc4']` is expected at step 2,869), and nothing else in the suite moves.
   */
  setFocus(states: number[]): void {
    this.#focused = this.#index === null ? new Set() : focusedRows(this.#index, states)
  }

  /**
   * Show or hide the `copy · not linked` status — design §4.5's second surface, paired with the sentence
   * `link-status.ts` puts in `#link-status`. Same name and same shape as `LambdaPane.setDetached`;
   * that method's doc carries the naming argument, which is not repeated here.
   *
   * **THIS FILE NOW HAS TWO UNRELATED MEANINGS OF "DETACHED", AND THE SPEC DID NOT NOTICE.**
   * `Follow`'s detach — `#reattach`, the grid's `following`, `state-table.ts`'s own vocabulary — means
   * THE USER SCROLLED THE δ-TABLE AWAY FROM THE CURRENT ROW, a scroll-position fact about one widget
   * inside this pane, undone by the `follow current rule` button sitting a few lines above the table. §4.5's
   * detached means THIS PANE IS BOUND TO A SCRATCH SESSION and is outside the correspondence
   * entirely, undone by rebinding it — through the pane's own selector, or by the retire that ends the
   * buffer (§4.3). ("undone only by a recompile from source" is what this read while a source keystroke
   * ended buffers; 5d-ii-c decision 2 removed that, and a recompile now leaves a detached pane
   * detached.) They can be true independently and in any combination.
   *
   * The status reads `copy · not linked` (Plan 7 part 2 spec §12) and the two are not confusable ON
   * SCREEN — the status sits in the header's `<h2>`, after the view's title, while the follow state
   * is a button captioned `follow current rule` in the rules panel's header. In CODE they are one word
   * apart, so the status lives in `#header` rather than in anything containing "detach", and this note
   * exists so the next reader of the grid's `beforeDraw`, which sets `#reattach.hidden`, does not go looking
   * for a connection.
   *
   * **THE COPY'S EDITOR AND *EDIT A COPY* FOLLOW `detached` TOO**, in `#copy` (`CopyEditor.setDetached`, whose doc
   * has the two review findings behind them): an editor cannot outlive the copy it edits, and a view already showing
   * a copy has nothing left to copy.
   */
  setDetached(detached: boolean): void {
    this.#header.setDetached(detached)
    this.#copy.setDetached(detached)
    // A PANE ON SOURCE DESCRIBES NO BUFFER, so nothing a buffer told it may stay on screen, whichever route moved it
    // there. Every route that moves a pane onto source reseeds it before this runs (`pane-host.ts`'s `seedTmPane` doc
    // lists them), so this clear, kept by the project owner's decision, is a second line behind that seed rather than
    // what tells a moved pane. GUARDED, because `PaneSlot.render` calls this on every frame: once both are `null` it
    // compares two fields and writes nothing.
    if (!detached && (this.#scratch !== null || this.#reading !== null)) {
      this.setScratchStatus(null)
      this.setScratchValue(null)
    }
  }

  /** Spec §8's `steps` switch, per `PaneView.setStepsShown` — the view's header owns the slot. */
  setStepsShown(shown: boolean): void {
    this.#header.setStepsShown(shown)
  }

  /**
   * Mount a copy's editor over this pane's body seeded with `text`, or unmount it with `null` — `CopyEditor.setEditor`,
   * whose doc carries the contract. An unmount clears the copy's status with it (`#scratch`'s doc).
   */
  setEditor(text: string | null, collapsed = false): void {
    this.#copy.setEditor(text, collapsed)
  }

  /** Give up the mounted editor without destroying it — `CopyEditor.takeEditor`. */
  takeEditor(): ScratchEditor | null {
    return this.#copy.takeEditor()
  }

  /** Mount an editor this pane did not build — `CopyEditor.receiveEditor`, for *move the editor here*. */
  receiveEditor(editor: ScratchEditor, collapsed = false): void {
    this.#copy.receiveEditor(editor, collapsed)
  }

  /** Whether this pane is showing an editor — `CopyEditor.holdsEditor`. */
  holdsEditor(): boolean {
    return this.#copy.holdsEditor()
  }

  /** Whether another view holds this copy's editor, for *move the editor here* — `CopyEditor.setEditorAvailable`. */
  setEditorAvailable(available: boolean): void {
    this.#copy.setEditorAvailable(available)
  }

  /** Send the mounted editor's pending edit now — `CopyEditor.flushEditor`. */
  flushEditor(): void {
    this.#copy.flushEditor()
  }

  /**
   * Render a scratch's status — the fields `TmState`/`TmProgram`'s own per-frame status line
   * (`render`, above) has no counterpart for.
   *
   * **`header: false` GETS A SENTENCE, NOT A COLOUR** (the accessibility list's item 7). `parse_tm_full`
   * explicitly does not treat a missing header as an error, so nothing upstream says this; the machine
   * runs from blank tapes at `MIN_FIELD_WIDTH` and the user needs to know they are not watching the
   * machine they pasted.
   *
   * **`width` AND `run` ARE NEVER GUARDED WITH `=== null` HERE**, unlike `TmStatus`'s pair. Both are
   * plain, non-optional fields on `TmScratchStatus` — its own doc has the argument for why a `TmScratch`
   * has no leg to decline the way a `Session` does — so a null check against either would be dead code
   * guarding against a wire shape that cannot arrive.
   *
   * **THERE IS NO STEP TOTAL TO RENDER AND NONE IS INVENTED.** `TmScratchStatus` has no `total_steps`
   * because a scratch is stepped rather than described-run; the results readout does not exist for a
   * scratch at all, so nothing here needs to accommodate its absence.
   *
   * **STORES `s` AND CALLS `#drawStatus`; IT DOES NOT WRITE `#status` ITSELF — Critical fix, review of
   * Task 8.** `render`, below, is on the per-frame path and used to write `#status.textContent`
   * unconditionally on both of its branches, which meant whichever of the two ran next after a
   * `tm-scratch-compiled` reply erased this call's text before a single tape row was drawn — `header:
   * false` is the one thing the design says this pane must surface loudly, and as committed it survived
   * zero frames. `#drawStatus` is the one place that composes the line's parts, the same idiom
   * `LambdaPane.#refreshClaim`/`#refreshDetach` already use: setters write private fields, one private
   * refresher owns the DOM write.
   *
   * **`null` SAYS THE PANE SHOWS NO BUFFER'S FILE** — a rebind onto a session with no reading, or a buffer whose
   * worker died. It is `setScratchValue(null)`'s twin, and `#scratch`'s doc lists the callers.
   */
  setScratchStatus(s: TmScratchStatus | null): void {
    this.#scratch = s
    this.#drawStatus()
  }

  /**
   * Show the value run's latest reading, or an empty line for `null` — `setScratchStatus`'s shape: store, then let the
   * one writer of the line compose it.
   */
  setScratchValue(reading: ValueReading | null): void {
    this.#reading = reading
    this.#drawValue()
  }

  /**
   * The one writer of `#value`, its text and its `aria-busy` alike. No scratch, no text: an attached pane shows no
   * value run. See `#value`'s doc for why the line is emptied rather than hidden.
   */
  #drawValue(): void {
    const line = this.#scratch === null ? null : valueLine(this.#reading)
    this.#value.textContent = line ?? ''
    if (line !== null && this.#reading?.run.run === 'Running') this.#value.setAttribute('aria-busy', 'true')
    else this.#value.removeAttribute('aria-busy')
  }

  /**
   * Record the machine a fork would carry, its rule count, and whether its result type has a decoding a
   * header can name — the three facts that word a refusal — `CopyEditor.setForkAvailable`, whose doc and
   * `#refreshDetach`'s carry the rule and the review fixes behind it.
   */
  setForkAvailable(text: string | null, rules: number, resultDecodable: boolean): void {
    this.#copy.setForkAvailable(text, rules, resultDecodable)
  }

  /**
   * Offer `options` in the pane selector and show `current` as the pair in force. Same shape and same
   * contract as `LambdaPane.setBindings`; that method's doc carries the argument for pushing the list
   * in rather than letting a pane hold a registry, and the argument for `Binding<Leg>` rather than
   * `Binding<'tm'>`, and neither is repeated here.
   */
  setBindings(options: PaneOption[], current: Binding<Leg>): void {
    this.#header.setBindings(options, current)
  }

  /**
   * Which layout gestures this pane currently offers, and what a split may create. Same shape and same
   * contract as `LambdaPane.setLayoutControls`; that method's doc carries the argument for driving this
   * from `main.ts`'s draw pass rather than from the pane, and `PaneView.setLayoutControls` carries the
   * argument for `choices` riding this call. Neither is repeated here.
   */
  setLayoutControls(canClose: boolean, canSplit: boolean, choices: SplitChoices): void {
    this.#choices = choices
    this.#menu.setLayout(canClose, canSplit)
  }

  render(frame: TmState | null, controls: ControlState): void {
    this.#frame = frame
    this.#steps.update(controls)
    this.#diagram.render(this.#program === null ? null : frame)
    this.#syncDiagramReattach()
    if (frame === null || this.#program === null) {
      this.#drawStatus()
      this.#tapes.replaceChildren()
      this.#drawTable()
      return
    }

    this.#drawStatus()

    this.#tapes.replaceChildren(
      ...tapeRows(frame, this.#names).map((row) => {
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
   * The one writer of `#status.textContent` — Critical fix, review of Task 8. Composes three independent
   * parts; the first two used to be written by three different call sites racing over the same element:
   *
   *   * THE PER-FRAME HALF — `` `${name} · width ${n(width)}` `` — empty whenever there is no frame or
   *     no program to name a state in, exactly the condition `render`'s own frame-null branch used to
   *     test before writing `''` directly.
   *   * THE HEADERLESS SENTENCE, when `#scratch !== null && !#scratch.header` — `TmScratchStatus`'s own
   *     doc has the argument for why this is worth a sentence: a headerless machine runs from blank
   *     tapes at `MIN_FIELD_WIDTH` rather than the input the user pasted, and nothing else in the app
   *     can say so.
   *   * THE REDUCED SENTENCE, `` `reduced: ${stages} · ${n(steps)} steps` ``, when `#scratch.reduction` is set: a
   *     file reduced through one or more stages, whose recorded step count is the run's whole budget.
   *
   * **EMITTED ON THE FRAME-NULL BRANCH TOO**, which is the moment right after a `tm-scratch-compiled`
   * reply — before `resetLegs` has produced a first frame to render — when the sentence matters most.
   * The width is stated once, inside the sentence itself, rather than repeated ahead of it the way the
   * pre-fix text `` `scratch · width ${n(s.width)} · no header — blank tapes at width ${n(s.width)}` ``
   * did.
   */
  #drawStatus(): void {
    const frame = this.#frame
    const program = this.#program
    // A `StateId` past the end yields no name rather than an index nobody can read — the same
    // no-fallback rule `TmState::source_node` follows one layer in.
    const perFrame =
      frame === null || program === null
        ? ''
        : `${program.states[frame.state]?.name ?? `state ${frame.state}`} · width ${n(program.width)}`
    const scratch = this.#scratch
    const headerless = scratch !== null && !scratch.header ? `no header — blank tapes at width ${n(scratch.width)}` : ''
    const reduction = scratch?.reduction ?? null
    const reduced = reduction === null ? '' : `reduced: ${reduction.stages.join(', ')} · ${n(reduction.steps)} steps`
    this.#status.textContent = [perFrame, headerless, reduced].filter((s) => s !== '').join(' · ')
  }

  /**
   * Draw the rule table: `VirtualGrid.draw`, with this view's rows (`#tableRows`). The grid also draws on its own for
   * a scroll, a resize, a key and a click; this is the draw for everything the grid cannot see change — a frame, a
   * program, a link, the panel opening.
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
      // this (`GridRows.frame`'s own doc, amendment 21): the row above is the CURRENT STATE's header, which a
      // step that loops in its own state — the ordinary case in a compiled machine — leaves unchanged, so a
      // hold keyed on that row alone would never release.
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
