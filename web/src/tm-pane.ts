import type { ControlState } from './controls'
import type { EditablePane } from './editor-custody'
import { EDITOR_DEBOUNCE_MS } from './editor-debounce'
import { n } from './format'
import type { Dir } from './layout'
import { type PaneChoice, type PaneEvents, type SplitChoices, textPanel } from './pane-chrome'
import { createPanel, type Panel } from './panel'
import type { Leg } from './protocol'
import { valueLine } from './results'
import { ScratchEditor } from './scratch-editor'
import type { Binding, PaneOption } from './sessions'
import { centredScrollTop, Follow, focusedRows, highlight, linkedRows, ROW_HEIGHT, StateIndex } from './state-table'
import { stepControls } from './step-controls'
import { tapeRows } from './tape'
import type { TmProgram, TmScratchStatus, TmState, ValueReading } from './types'
import { type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
import { visibleWindow } from './virtual-list'

export { ROW_HEIGHT } from './state-table'

/** Rows rendered beyond the viewport on each side, so a fast scroll does not show blank space. */
export const OVERSCAN = 4

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
 * **`implements EditablePane` (5d-iv Task 8), THE SECOND CLASS TO CARRY THE CLAUSE.** `LambdaPane`'s
 * own doc records why it is load-bearing rather than decorative: `editor-custody.ts`'s cast to
 * `EditablePane` goes through `unknown` of necessity, so without this clause `tsc` verifies nothing
 * about whether this class actually satisfies the shape custody casts to — a renamed method would pass
 * silently. The four members below (`setEditor`, `takeEditor`, `receiveEditor`, `holdsEditor`) are
 * ported from `LambdaPane`'s own, leg-agnostic apart from the wording custody's caller never sees.
 */
export class TmPane implements EditablePane {
  #status: HTMLElement
  #tapes: HTMLElement
  #steps: ReturnType<typeof stepControls>
  /** The view's header — `LambdaPane`'s `#header`, the same component. */
  #header: ViewHeader
  /**
   * The upper half of design §4.2's split body, ported to this leg — a stable parent that outlives any
   * editor mounted or unmounted inside it, so `setEditor` can do both without touching the pane's own
   * child order. Same contract as `LambdaPane`'s own `#editorHost`; that field's doc carries the
   * argument for why it carries no class until `setEditor` gives it one, and is not repeated here.
   */
  #editorHost: HTMLElement
  /**
   * The mounted `ScratchEditor`, or `null` on an attached pane. Same contract as `LambdaPane`'s own
   * `#editor` — never `null` merely because the editor is collapsed away, since collapsing here sets
   * `hidden` on `#editorHost` through the text panel (below), not on this field.
   */
  #editor: ScratchEditor | null = null
  #collapse: ReturnType<typeof textPanel>
  /**
   * `on.editScratch`, captured once at construction — `setEditor` reads it per mount rather than
   * closing over `on` directly. Same idiom as `LambdaPane.#onEdit`; that field's doc carries the
   * argument.
   */
  #onEdit: ((src: string) => void) | undefined
  /**
   * The pane's own body — everything below the heading row, wrapped in one element for `host.replaceChildren`
   * below.
   *
   * **THE COLLAPSE IS NO LONGER A FACT ABOUT THIS ELEMENT, WHICH REVERSES WHAT THIS DOC USED TO SAY —
   * Plan 7 part 1 Task 8.** It used to carry a `.collapsed` class of its own, read by an ancestor
   * selector in `style.css` so the tape rows and δ-table stayed outside the thing the toggle named. The
   * text panel (`textPanel`, constructor below) wraps `#editorHost` directly and hides it with `hidden`
   * instead — the same mechanism `LambdaPane` uses — so `#body` carries no class for this at all, and
   * `#drawTable`'s own independence from a collapse now follows from `#editorHost` being a child of the
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
   * **CLEARED IN `setEditor(null)` AND `takeEditor()`, NOT ONLY SET IN `setScratchStatus`.** A pane
   * rebound off the scratch it was reporting for must stop narrating that scratch's header — the same
   * "fabricated state" class of defect `LambdaPane.setDetached`'s own doc records finding, pointed the
   * other way: there the bug was an editor outliving the fact that made it appear, here it would be a
   * sentence outliving the editor it describes.
   *
   * **THOSE TWO CLEARS REACH ONLY THE PANE HOLDING THE EDITOR, AND A BUFFER'S STATUS REACHES EVERY PANE ON IT —
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
   * copy offered rather than one that offers a copy and swallows it. No `claim`: `PaneEvents.showEditor`
   * is λ-only, as its doc says.
   */
  #menu: ViewMenu
  /**
   * The last `setForkAvailable` call's two facts, kept so `#refreshDetach` can re-evaluate them on
   * every frame rather than only at the moment they arrived — Critical fix, fix round on Task 9.
   *
   * **WITHOUT THIS PAIR, THE CONTROL COULD OUTLIVE THE FORK IT JUST PERFORMED.** `replies.ts`'s
   * `setTmProgram` calls `setForkAvailable` over `panes.ofSession('tm', session)` for the SOURCE session,
   * and `pane-host.ts`'s `seedTmPane` calls it when a pane is created or moved by a pick, a cool or a
   * retire, which a fork is not. `scratchpad.fork` rebinds this pane's
   * slot to the new scratch SYNCHRONOUSLY, so the pane leaves that set on the very click that forked
   * it — nothing calls `setForkAvailable` again to say the new session has nothing to fork. Storing
   * the two facts here is what lets a LATER call that has nothing to do with forking — `setDetached`,
   * driven every frame by `PaneSlot.render` regardless of which session this pane is bound to — still
   * re-derive the right answer. Same idiom `LambdaPane.#menu`'s own doc states for `#detached`
   * itself: a fact two different calls both need has to be readable by whichever one runs second.
   */
  #tmText: string | null = null
  #rules = 0
  /**
   * Whether this pane's own session is outside the source correspondence — `LambdaPane`'s field of
   * the same name, ported for the identical reason: `#refreshDetach` needs it alongside `#tmText`/
   * `#rules`, and it arrives through a different call (`setDetached`) than either of those two do.
   */
  #detached = false

  #tableHost: HTMLElement
  #spacer: HTMLElement
  #rows: HTMLElement
  /**
   * The rule table as a panel (Plan 7 part 1, spec §8): the body is `#tableHost`, the header action is
   * `#reattach`. The panel hides and shows `#tableHost` and holds whether the table is open (`isOpen`);
   * this class keeps no copy, so a `setOpen` cannot leave one stale. Its `onToggle` redraws. Not `#rules`,
   * which is the machine's rule count.
   */
  #rulesPanel: Panel
  #reattach: HTMLButtonElement
  #index: StateIndex | null = null
  #follow = new Follow()
  #linked: Set<number> = new Set()
  /**
   * The running focus's own rows — a SECOND, INDEPENDENT layer from `#linked` above, mirroring the
   * source pane's "pin and focus are different objects, both may be on screen" split (design §4.3).
   * `#linked` moves on a click; this moves every δ-step. See `setFocus`'s own doc for why it never
   * drives a scroll the way `setLink` can.
   */
  #focused: Set<number> = new Set()
  /**
   * A one-shot scroll target `#drawTable` honours in preference to `Follow`'s own target, for exactly
   * the next draw — see `setLink`'s doc and design §5.1. `null` when there is nothing pending.
   */
  #pendingScroll: number | null = null
  /** The DOM index of `this.#rows.children[0]`, within `#index`. See `#drawTable`'s doc. */
  #firstDrawn = 0

  /**
   * `panels` is the view's stored panel state (`workspace.ts`'s `Panels`), read once here; the rules panel
   * reports every later toggle through `on.panel`.
   */
  constructor(host: HTMLElement, on: PaneEvents, panels: { readonly rules?: boolean } = {}) {
    this.#header = viewHeader(on.rebind)
    this.#status = document.createElement('div')
    this.#status.className = 'tm-status'
    this.#value = document.createElement('div')
    this.#value.className = 'tm-value'
    this.#value.setAttribute('role', 'status')
    // THE HOST IS IN THE DOM FROM CONSTRUCTION AND CARRIES NO CLASS UNTIL AN EDITOR IS MOUNTED — same
    // rule as `LambdaPane`'s own `#editorHost`, and that field's doc carries the argument.
    this.#editorHost = document.createElement('div')
    this.#editorHost.className = ''
    this.#onEdit = on.editScratch
    this.#tapes = document.createElement('div')
    this.#tapes.className = 'tapes'
    this.#steps = stepControls(on)
    // `detachMachine` carries no argument (`PaneEvents.detachMachine`'s own doc: a machine has no step-k
    // text to report), so the item's run is the handler itself rather than a closure over a frame.
    const detachMachine = on.detachMachine
    this.#menu = viewMenu(this.#header.actions, {
      ...(on.splitRow !== undefined && on.splitColumn !== undefined
        ? { split: (dir: Dir, c: PaneChoice) => (dir === 'row' ? on.splitRow?.(c) : on.splitColumn?.(c)) }
        : {}),
      ...(on.close !== undefined ? { close: on.close } : {}),
      ...(detachMachine !== undefined ? { editCopy: { run: detachMachine, what: 'the whole machine' } } : {}),
      choices: () => this.#choices,
    })
    // THE TEXT PANEL — the same control `LambdaPane` builds, with the same name ("text") where the two
    // used to say "term editor" and "machine source". It wraps `#editorHost` and hides it itself; this
    // callback only reports the gesture, for the buffer's record.
    this.#collapse = textPanel(this.#editorHost, (collapsed) => on.collapse?.(collapsed))

    // ADDED AND REMOVED, NEVER DISABLED — same idiom `pane-chrome.ts` states for the continue button.
    // A reattach only does something while the table is detached, so it exists only then; `#drawTable`
    // keeps `hidden` in sync every frame and every scroll, the one place both happen.
    this.#reattach = document.createElement('button')
    this.#reattach.type = 'button'
    this.#reattach.className = 'table-reattach'
    this.#reattach.textContent = 'follow current rule'
    this.#reattach.hidden = true
    this.#reattach.addEventListener('click', () => {
      const had = document.activeElement === this.#reattach
      this.#follow.attach()
      // Redraw now, not at the next step — otherwise the current row stays wherever the manual scroll
      // left it until the machine happens to advance.
      this.#drawTable()
      // THE BUTTON HIDES ITSELF — `#drawTable` sets `#reattach.hidden` once the table follows again — AND
      // MUST NOT TAKE THE FOCUS WITH IT (spec §11): the rules panel's toggle, beside it, takes it.
      if (had && this.#reattach.hidden) this.#rulesPanel.toggle.focus()
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
      // Chromium: step, close the rules panel, reopen it, and the table is detached with the current row
      // gone from the DOM. A hidden box cannot be scrolled by a person, so there is nothing here to honour.
      if (!this.#rulesPanel.isOpen()) return
      this.#follow.onScroll(this.#tableHost.scrollTop)
      this.#drawTable()
    })

    // CLICK A ROW, LIGHT ITS SOURCE. The table is 127,881 rows for `list60` and nothing in it says
    // what any row is FOR; this is the answer to that. Delegated from the container rather than bound
    // per row, because rows are recreated on every draw.
    this.#rows.addEventListener('click', (event) => {
      if (this.#index === null) return
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const el = target.closest('.state-row')
      if (!(el instanceof HTMLElement)) return
      const i = [...this.#rows.children].indexOf(el)
      if (i < 0) return
      const row = this.#index.row(this.#firstDrawn + i)
      if (row === null) return
      on.linkState?.(row.kind === 'state' ? row.id : row.stateId)
    })

    // THE RULE TABLE IS A PANEL. `panel.ts` hides `#tableHost` itself and carries the state in
    // `aria-expanded` rather than relabelling — accessibility item 2. `follow current rule` rides in the
    // panel's header, beside the thing it acts on.
    //
    // REDRAW IN BOTH DIRECTIONS, and the closing one is not symmetry for its own sake. `#drawTable` is
    // where `#reattach.hidden` is maintained, so skipping it on the way down left a live "follow" button
    // over a table that is not on screen — the idiom's own rule broken, and the closed-table term written
    // for it could never fire because `#drawTable`, where it is evaluated, did not run. Reopening matters
    // for a different reason: a hidden box has `clientHeight` 0, so any step taken while the table was
    // closed computed its scroll target against a zero-height viewport and left the head parked off
    // centre until some later step happened to recentre it.
    this.#rulesPanel = createPanel({
      name: 'rules',
      label: 'rules',
      body: this.#tableHost,
      open: panels.rules ?? true,
      onToggle: (open) => {
        this.#drawTable()
        on.panel?.('rules', open)
      },
    })
    this.#rulesPanel.actions.append(this.#reattach)

    // `#body` CARRIES EVERYTHING BELOW THE HEADING, WITH THE TEXT PANEL FIRST — design §4.1's "editor
    // region above, today's tape rows and δ-table below". An attached pane (no editor mounted) is
    // unchanged: the panel starts `hidden` and contributes no box to the flow, so this reordering is
    // invisible until `setEditor` gives it something to show.
    this.#body = document.createElement('div')
    this.#body.className = 'tm-pane'
    this.#body.append(this.#collapse.el, this.#status, this.#value, this.#tapes, this.#rulesPanel.el)
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

  /**
   * Highlight a link's state block, optionally scrolling to it.
   *
   * `scrollTo` IS FALSE WHEN THE CLICK CAME FROM THIS TABLE. Scrolling a list the user just clicked
   * in moves the row out from under their cursor; the caller knows where the gesture came from and
   * this does not have to guess.
   *
   * THE SCROLL DOES NOT TOUCH `Follow`'S OWN FLAG. Following is about the machine's current state, and
   * a link is about a construct — reusing `Follow` here would make a link click silently reattach a
   * table the user had deliberately detached, or detach one they had not. But `#drawTable`, called
   * unconditionally below, recomputes ITS OWN follow target whenever `#follow.following` is true — so
   * writing `scrollTop` here directly used to be reverted in the very same synchronous block the
   * instant following was on, which is the default state on every fresh compile. Design §5.1: a link
   * scroll is a direct user gesture and wins for exactly ONE draw; recording it as a one-shot pending
   * target rather than writing it here is what lets `#drawTable` honour it over the follow target for
   * that one draw without `Follow` itself ever being told the table stopped following.
   */
  setLink(states: number[], scrollTo: boolean): void {
    this.#linked = this.#index === null ? new Set() : linkedRows(this.#index, states)
    if (scrollTo && this.#index !== null && this.#rulesPanel.isOpen()) {
      const first = [...this.#linked].sort((a, b) => a - b)[0]
      if (first !== undefined) {
        // Shared with `Follow.targetScrollTop` via `centredScrollTop` — see that function's doc.
        this.#pendingScroll = centredScrollTop(
          first,
          ROW_HEIGHT,
          this.#tableHost.clientHeight,
          this.#index.rowCount * ROW_HEIGHT,
        )
      }
    }
    this.#drawTable()
  }

  /**
   * Highlight the running focus's own block: the state header (never the rules — `focusedRows`'s own
   * doc says why) of every state `states` names.
   *
   * NO `scrollTo`, UNLIKE `setLink`. A link's scroll is a direct user gesture that earns exactly one
   * draw's override of the follow target (`setLink`'s own doc, design §5.1); the running focus moves on
   * its own, every δ-step, with no gesture behind it — scrolling to it every time it moved would fight
   * `Follow`'s own scroll for the CURRENT row, which already runs unconditionally in `#drawTable`. The
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
   * `Follow`'s detach — `#reattach`, `#follow.following`, `state-table.ts`'s own vocabulary — means
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
   * exists so the next reader of `#drawTable`'s `#reattach.hidden` line does not go looking for a
   * connection.
   *
   * **AN EDITOR CANNOT OUTLIVE `#detached` HERE EITHER — Important finding, review of Task 8.**
   * `LambdaPane.setDetached`'s own doc records the same line ported below and the defect that made it
   * necessary: driving the app in a browser, picking `source` in a forked pane's selector dropped the
   * `[detached]` badge and repainted the body from the newly-bound leg, but left a live `contenteditable`
   * editor mounted on the buffer the pane had just left. That route is unreachable through this class
   * today — every path that could mount an editor here is λ-gated — but `PaneSlot.render` already calls
   * this method on every TM pane, every frame, so the invariant has to live here now rather than wait
   * for whichever future task first reaches a leaving-`#detached` route this class did not have before:
   * grepping the plan from here to the end for `setDetached` finds no reminder to add it later.
   */
  setDetached(detached: boolean): void {
    this.#detached = detached
    this.#header.setDetached(detached)
    if (!detached && this.#editor !== null) this.setEditor(null)
    // A PANE ON SOURCE DESCRIBES NO BUFFER, so nothing a buffer told it may stay on screen, whichever route moved it
    // there. Every route that moves a pane onto source reseeds it before this runs (`pane-host.ts`'s `seedTmPane` doc
    // lists them), so this clear, kept by the project owner's decision, is a second line behind that seed rather than
    // what tells a moved pane. GUARDED, because `PaneSlot.render` calls this on every frame: once both are `null` it
    // compares two fields and writes nothing.
    if (!detached && (this.#scratch !== null || this.#reading !== null)) {
      this.setScratchStatus(null)
      this.setScratchValue(null)
    }
    // THE FORK CONTROL IS THE OTHER THING THAT MOVES WHEN `#detached` DOES — Critical fix, fix round
    // on Task 9. `LambdaPane.setDetached`'s own call to `#refreshDetach` is the model: this is what
    // makes the control withdraw the instant THIS method's own input changes, on the very frame the
    // pane's session becomes the scratch a fork just made, rather than waiting for a `setForkAvailable`
    // call that a rebound pane will never receive again.
    this.#refreshDetach()
  }

  /** Spec §8's `steps` switch, per `PaneView.setStepsShown` — the view's header owns the slot. */
  setStepsShown(shown: boolean): void {
    this.#header.setStepsShown(shown)
  }

  /**
   * Mount an editor over this pane's body seeded with `text`, or unmount it with `null` — design
   * §4.2's upper region, ported to this leg. Same contract and same guards as `LambdaPane.setEditor`;
   * that method's doc carries the full argument (mounted-and-unmounted, the re-seed no-op inside
   * `ScratchEditor.setText`, `collapsed` seeding the mount and only the mount) and is not repeated here.
   *
   * **THE COLLAPSE FLAG LANDS THE SAME WAY `LambdaPane`'S DOES NOW, WHICH REVERSES WHAT THIS PARAGRAPH
   * USED TO SAY.** It read that the two panes differed in WHERE the flag landed — this one on a
   * `.collapsed` class on `#body`, `LambdaPane`'s on `#editorHost`'s own class — while agreeing on
   * WHETHER it did. Plan 7 part 1 Task 8 ended that difference: both panes hand `collapsed` to the text
   * panel (`textPanel`, constructor above), which hides `#editorHost` itself with `hidden`, so
   * `#editorHost` here only ever carries the bare `'term-editor'` class or none at all.
   *
   * **NO `#refreshClaim` CALL, UNLIKE `LambdaPane.setEditor`.** `PaneEvents.showEditor`'s own doc states
   * the "move the editor here" control exists only on a pane whose slot may be bound to a
   * scratch, "which today means the λ leg" — this pane is built with no `showEditor` handler and has no
   * claim control to refresh.
   */
  setEditor(text: string | null, collapsed = false): void {
    if (text === null) {
      this.#editor?.destroy()
      this.#editor = null
      this.#editorHost.className = ''
      this.#collapse.update(false)
      // THE SCRATCH STATUS GOES WITH THE EDITOR — see `#scratch`'s own doc. Cleared here rather than
      // left for whatever `render` happens next, because a caller reading `host.textContent` between
      // this call and the next frame must not see a sentence about a machine this pane no longer shows.
      this.#scratch = null
      this.#drawStatus()
      this.#drawValue()
      return
    }
    const onEdit = this.#onEdit
    if (this.#editor === null) {
      this.#editorHost.className = 'term-editor'
      this.#editor = new ScratchEditor({
        host: this.#editorHost,
        initial: text,
        debounceMs: EDITOR_DEBOUNCE_MS,
        onEdit: (src) => onEdit?.(src),
      })
      this.#collapse.update(true, collapsed)
      return
    }
    this.#editor.setText(text)
  }

  /**
   * Detach this pane's mounted editor WITHOUT DESTROYING IT, for a caller about to remount it on a
   * different pane. Same contract as `LambdaPane.takeEditor`; that method's doc carries the full
   * argument for why the node itself is removed rather than merely dereferenced (a `LeafId` handover
   * that survives, where the whole host does not leave with it), and is not repeated here.
   */
  takeEditor(): ScratchEditor | null {
    const editor = this.#editor
    if (editor === null) return null
    this.#editor = null
    editor.dom.remove()
    this.#editorHost.className = ''
    this.#collapse.update(false)
    // SAME REASON AS `setEditor(null)`'s OWN CLEAR, ABOVE — this pane is giving the editor up, so it
    // must stop announcing that editor's scratch's header the instant it does.
    this.#scratch = null
    this.#drawStatus()
    this.#drawValue()
    return editor
  }

  /**
   * Mount an editor this pane did not build — `takeEditor`'s other half. Same contract and same guard
   * as `LambdaPane.receiveEditor`, including the throw on a pane already holding one; that method's doc
   * carries the full argument (the two review findings that made the throw and the `collapsed` seeding
   * necessary) and is not repeated here.
   */
  receiveEditor(editor: ScratchEditor, collapsed = false): void {
    if (this.#editor !== null) throw new Error('a TM pane was handed a second editor while still holding one')
    this.#editorHost.className = 'term-editor'
    this.#editorHost.append(editor.dom)
    // THE EDITS FOLLOW THE VIEW — same fix and same reason as `LambdaPane.receiveEditor`'s own `onEdit`
    // reassignment; that method's doc carries the argument in full.
    const onEdit = this.#onEdit
    editor.onEdit = (src) => onEdit?.(src)
    this.#editor = editor
    this.#collapse.update(true, collapsed)
  }

  /**
   * Whether this pane is currently showing an editor. `takeEditor`'s question without `takeEditor`'s
   * answer — same contract as `LambdaPane.holdsEditor`; that method's doc carries the argument.
   */
  holdsEditor(): boolean {
    return this.#editor !== null
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
   * Record the machine a fork would carry and the count a refusal would name — `viewMenu`'s `CopyState` rule,
   * as a data dependency rather than a convention — design §4.3. Stores the two facts and defers to
   * `#refreshDetach`, the same split `setDetached` above and `LambdaPane.setEditor`/`setDetached`
   * already use: a setter that only ever WROTE the control from here would go stale the moment this
   * pane stopped being the pane `replies.ts`'s fan-out still calls it on — see `#tmText`'s own doc.
   */
  setForkAvailable(text: string | null, rules: number): void {
    this.#tmText = text
    this.#rules = rules
    this.#refreshDetach()
  }

  /**
   * The one writer of the fork control's state — Critical fix, fix round on Task 9. Composes three
   * independent facts that arrive through two different calls (`setForkAvailable` and `setDetached`),
   * the same shape `LambdaPane.#refreshDetach` already uses and for the identical reason: whichever
   * call runs second has to see what the other one left.
   *
   * **`!this.#detached` GATES PRESENCE, AND ITS ABSENCE WAS THE WHOLE BUG.** `setForkAvailable` alone
   * cannot express "this pane's OWN session just became the thing it would fork" — that fact arrives
   * through `setDetached`, driven every frame by `PaneSlot.render` regardless of which session this
   * pane is bound to, which is exactly why it is the one call `LambdaPane`'s own `#refreshDetach`
   * checks first. Left out (as it shipped), the control kept whatever `rules`/`text` the SOURCE
   * session last reported, forever, on a pane that had since rebound onto its own new scratch — the
   * button stayed present and enabled, and a second click reached `transport.ts`'s `detachMachine`
   * with `tmText === null` (a scratch's own `tmProgram.tmText` is always `null`,
   * `replies.ts`'s `tm-scratch-compiled` arm builds it that way) and threw. The rule this enforces:
   * A VIEW ALREADY SHOWING A COPY HAS NOTHING LEFT TO COPY.
   *
   * **`this.#tmText !== null || this.#rules > 0` IS WHETHER THE CONTROL SHOWS AT ALL — widened from a
   * bare `rules > 0`, Minor fix in the same round.** A `TmCompiled` whose program parsed to zero δ
   * rules (`ruleCount(program) === 0`) still has non-`null` `tmText` and is genuinely forkable —
   * `tests/node/sessions.test.ts`'s own fixture for the machine-fork handler constructs exactly that
   * shape (one accept state, no rules). `rules > 0` alone withdrew the control for it though nothing
   * about the machine made it unforkable; `text !== null` is the worker's own `forkable` decision
   * (`ruleCount(compiled.program)` disagreeing with it only in the direction rules-but-no-text, which
   * `text === null` below still catches) and is the fact that actually decides presence.
   *
   * `text === null` IS STILL WHETHER IT IS DISABLED, UNCHANGED FROM BEFORE THIS ROUND. A session WITH
   * a machine that is over `MAX_FORK_RULES` (`text === null`, `rules > 0`) is the one case this pane
   * presents disabled rather than absent: the machine exists, the refusal is a size limit rather than
   * an absence, and `CopyState`'s own doc has the argument for why that distinction is worth a
   * visible control. `rules` is for the WORDING of the disabled reason and never for the decision to
   * disable — the worker already made that decision, with `forkable`, encoded entirely in whether
   * `text` is `null`. Guarded by `!this.#detached` too, for the same reason presence is: a pane that
   * has just withdrawn the control entirely has nothing left to disable.
   */
  #refreshDetach(): void {
    if (this.#detached || (this.#tmText === null && this.#rules === 0)) {
      this.#menu.setCopy(null)
      return
    }
    this.#menu.setCopy(
      this.#tmText === null ? { reason: `${n(this.#rules)} rules — too large to open in an editor` } : 'ready',
    )
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
   * Draw only the rows in view. Called on every frame AND on every scroll, so it must stay O(visible)
   * rather than O(rowCount) — 127,881 rows is the number that decides it.
   */
  #drawTable(): void {
    // Kept in sync HERE, not in the click handlers, because this is the one place that runs on every
    // frame AND every scroll — the two ways `#follow.following` can change. Hidden with no program at
    // all (reattaching means nothing against an empty table) and while the table is closed, where the
    // button would offer to reposition something nobody can see — the same idiom the control itself
    // follows, which exists so a control is present only when it does something.
    this.#reattach.hidden = this.#index === null || this.#follow.following || !this.#rulesPanel.isOpen()

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
    if (!this.#rulesPanel.isOpen()) return

    // `.state-table`'s `max-height: 40vh` is the ONLY thing bounding this box, and `clientHeight`
    // reports what it actually laid out rather than what the stylesheet asked for. If the rule never
    // reaches the page the box grows to its full content height — measured at 271,968px for 11,332
    // rows — `spanned` covers the whole table, and every draw renders every row. The browser tier
    // loads `style.css` (`tests/browser/setup.ts`) and asserts this box stays bounded, so that gap
    // fails a test rather than silently costing O(rowCount) per frame.
    const viewportHeight = this.#tableHost.clientHeight
    const marks = highlight(this.#index, this.#frame)
    // A PENDING LINK SCROLL WINS OVER THE FOLLOW TARGET FOR EXACTLY THIS DRAW, then is consumed —
    // design §5.1. Read and cleared together so a link recorded during THIS call is what the very next
    // draw honours, never twice: `Follow`'s `#expected` is armed ONCE below, by whichever branch runs,
    // rather than by the pending write here and then again by the follow write that used to run
    // unconditionally after it and silently revert it in the same synchronous block.
    const pending = this.#pendingScroll
    this.#pendingScroll = null
    if (pending !== null) {
      if (pending !== this.#tableHost.scrollTop) {
        this.#follow.onProgrammaticScroll(pending)
        this.#tableHost.scrollTop = pending
      }
    } else if (marks !== null) {
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
    // THE VIRTUALIZATION OFFSET THE CLICK HANDLER NEEDS. `this.#rows.children[i]`'s row number is
    // `w.firstIndex + i`, not `i` — the rows array is windowed and `translateY`-offset, so recording
    // anything else here lights a plausible-looking but wrong block the moment the table is scrolled.
    this.#firstDrawn = w.firstIndex
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
      if (this.#linked.has(i)) el.classList.add('is-linked')
      if (this.#focused.has(i)) el.classList.add('is-focus')
      els.push(el)
    }
    this.#rows.replaceChildren(...els)
  }
}
