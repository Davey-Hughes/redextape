import type { ControlState } from './controls'
import { n } from './format'
import { bindingSelect, controlStrip, detachedBadge, layoutControls, type PaneEvents } from './pane-chrome'
import type { SessionId } from './session-client'
import type { BindingOption } from './sessions'
import { centredScrollTop, Follow, focusedRows, highlight, linkedRows, ROW_HEIGHT, StateIndex } from './state-table'
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
  #badge: ReturnType<typeof detachedBadge>
  #select: ReturnType<typeof bindingSelect>
  #layout: ReturnType<typeof layoutControls>
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
  #linked: Set<number> = new Set()
  /**
   * The running focus's own rows — a SECOND, INDEPENDENT layer from `#linked` above, mirroring the
   * source pane's "pin and focus are different objects, both may be on screen" split (design §4.3).
   * `#linked` moves on a click; this moves every δ-step. See `setFocus`'s own doc for why it never
   * drives a scroll the way `setLink` can.
   */
  #focused: Set<number> = new Set()
  #open = true
  /**
   * A one-shot scroll target `#drawTable` honours in preference to `Follow`'s own target, for exactly
   * the next draw — see `setLink`'s doc and design §5.1. `null` when there is nothing pending.
   */
  #pendingScroll: number | null = null
  /** The DOM index of `this.#rows.children[0]`, within `#index`. See `#drawTable`'s doc. */
  #firstDrawn = 0

  constructor(host: HTMLElement, on: PaneEvents) {
    const title = document.createElement('h2')
    title.textContent = 'turing machine'
    this.#badge = detachedBadge(title)
    // Anchored to the title for the reason `LambdaPane`'s constructor states: the control removes
    // itself below two options and needs somewhere to go back to.
    this.#select = bindingSelect(title, on.rebind)
    this.#status = document.createElement('div')
    this.#status.className = 'tm-status'
    this.#tapes = document.createElement('div')
    this.#tapes.className = 'tapes'
    this.#strip = controlStrip(on)
    this.#layout = layoutControls(this.#strip.el, on)

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
    if (scrollTo && this.#index !== null && this.#open) {
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
   * Show or hide the `[detached]` badge — design §4.5's second surface, paired with the sentence
   * `link-status.ts` puts in `#link-status`. Same name and same shape as `LambdaPane.setDetached`;
   * that method's doc carries the naming argument, which is not repeated here.
   *
   * **THIS FILE NOW HAS TWO UNRELATED MEANINGS OF "DETACHED", AND THE SPEC DID NOT NOTICE.**
   * `Follow`'s detach — `#reattach`, `#follow.following`, `state-table.ts`'s own vocabulary — means
   * THE USER SCROLLED THE δ-TABLE AWAY FROM THE CURRENT ROW, a scroll-position fact about one widget
   * inside this pane, undone by the `follow` button sitting a few lines above the table. §4.5's
   * detached means THIS PANE IS BOUND TO A SCRATCH SESSION and is outside the correspondence
   * entirely, undone only by a recompile from source (§4.3). They can be true independently and in
   * any combination.
   *
   * The badge's text is left as `[detached]` because §4.5 fixes that wording and the two are not
   * confusable ON SCREEN — the badge sits in the `<h2>` and reads "turing machine [detached]", while
   * the follow state is a button captioned `follow` beside the table. In CODE they are one word apart,
   * so the private field is `#badge` rather than anything containing "detach", and this note exists so
   * the next reader of `#drawTable`'s `#reattach.hidden` line does not go looking for a connection.
   */
  setDetached(detached: boolean): void {
    this.#badge.update(detached)
  }

  /**
   * Offer `options` in the binding selector and show `current` as the one in force. Same shape and
   * same contract as `LambdaPane.setBindings`; that method's doc carries the argument for pushing the
   * list in rather than letting a pane hold a registry, and it is not repeated here.
   */
  setBindings(options: BindingOption[], current: SessionId): void {
    this.#select.update(options, current)
  }

  /**
   * Which layout gestures this pane currently offers. Same shape and same contract as
   * `LambdaPane.setLayoutControls`; that method's doc carries the argument for driving this from
   * `main.ts`'s draw pass rather than from the pane, and it is not repeated here.
   */
  setLayoutControls(canClose: boolean, canSplit: boolean): void {
    this.#layout.update(canClose, canSplit)
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
