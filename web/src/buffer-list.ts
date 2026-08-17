import type { SessionId } from './session-client'

/**
 * One scratch buffer, as the header list renders it.
 *
 * **`paneCount` IS A NUMBER AND NOT AN `orphan: boolean`, WHICH IS THE WHOLE SHAPE OF THIS TYPE.**
 * Design §4.2 refuses a confirmation dialog for retire and puts the row's own information in its
 * place: retiring a buffer two panes are showing has to LOOK different from reclaiming one nothing is
 * showing, before the click rather than after it. A boolean would collapse "some panes are bound" into
 * one word and leave the user with the same row text for both of the cases the safeguard exists to
 * tell apart. The orphan marker is then derived rather than carried — one fact, rendered two ways.
 *
 * IT NAMES A SESSION AND CARRIES NO REFERENCE TO ONE. This module knows nothing about the registry,
 * the pool or the panes: a row is a label to draw and an id to hand back, so the control can be driven
 * from a fixture in test and from the registry in the app without either being the other's shape. The
 * `id` crosses back through `onRetire` untouched, which is the only thing this file does with it.
 */
export type BufferRow = {
  readonly id: SessionId
  readonly label: string
  readonly paneCount: number
  /**
   * The buffer's current term, or `null` when it has none — **the only field on this row that differs
   * between two buffers, and it was not here when the list shipped.**
   *
   * **WITHOUT IT A ROW IS A COUNTER'S OUTPUT AND A PANE COUNT, AND AT THE CAP EVERY PANE COUNT IS THE
   * SAME TOO.** The one gesture this control exists for is *choose a buffer and end it* — and the user
   * reaching it under a refusal has just been told they must choose, with no basis whatsoever on which
   * to do so. `label` is `scratch N` BY CONSTRUCTION (`#minted` only counts up), so no amount of naming
   * fixes this: the distinguishing fact is what the buffer HOLDS.
   *
   * `string | null` RATHER THAN AN EMPTY STRING FOR THE ABSENT CASE, because the two are different
   * things the row says differently: a buffer whose fork has not answered yet, or never will, has no
   * term — where a buffer holding the empty term is not a state the worker can produce. The renderer
   * marks the absent case rather than drawing a blank line, since a blank line under a name reads as a
   * rendering fault rather than as a fact about the buffer.
   *
   * THAT MARKING IS NOW SCOPED TO A WARM ROW, since `warm` below split `null` into two facts this field
   * alone cannot tell apart. A cold buffer's `term` is null too, but `bufferRow` does not draw a line
   * for it at all — the row is already marked "asleep" on its name line, and a second line reading `no
   * term yet` underneath would restate the same absence in a wording that claims a fault this buffer
   * does not have. See `warm`'s own doc for the argument in full.
   *
   * STILL NO REFERENCE TO A SESSION, per the paragraph below: this is a STRING the caller resolved, not
   * a leg this module reads. `main.ts` joins it from the registry the same way it joins `paneCount` from
   * the pane collection, for the same reason — the join belongs at the one place holding both.
   *
   * For what this doc used to claim and why it changed, see the history note under `BufferRow.term`.
   */
  readonly term: string | null
  /**
   * Whether this buffer holds a worker.
   *
   * **A COLD BUFFER IS TEXT AND A NAME, AND NOTHING THIS MODULE CAN ASK ABOUT** (design §4.2). It has
   * no session, so `term` is necessarily `null` for one — and that `null` means something different
   * from the one a warm buffer produces. A warm buffer with no term is a fork that has not answered or
   * never will; a cold one simply is not running. The row says which, because "no term" under a name
   * reads as a fault where "asleep" reads as a state.
   */
  readonly warm: boolean
}

/**
 * Unique ids for the popovers, so `aria-controls` on a list button names exactly one element.
 *
 * A COUNTER RATHER THAN A FIXED STRING, EVEN THOUGH THE HEADER BAR IS ONE. `pane-chrome.ts`'s
 * `pickerSeq` needs one because panes are plural; this function needs one because nothing in its
 * signature makes the singleton true, and two calls in one document would mint the same id twice —
 * which is precisely the thing an id reference cannot survive, and which fails silently.
 */
let listSeq = 0

/**
 * How a row states its pane count, or that it has none.
 *
 * `orphan` REPLACES THE COUNT RATHER THAN JOINING IT (design §4.2: "its pane count **or** `— orphan`").
 * "0 panes — orphan" says one fact twice, and the zero case is the one that needs a word rather than a
 * number: it is the state that makes this whole control necessary, since a buffer no pane is showing
 * has no chrome anywhere else to reach it.
 *
 * THE SINGULAR IS SPELLED OUT because the list's job is to be read at a glance under a gesture that
 * destroys work, and "1 panes" is the kind of seam that makes a reader stop trusting the rest of the row.
 */
const paneReadout = (paneCount: number): string => {
  if (paneCount === 0) return 'orphan'
  return paneCount === 1 ? '1 pane' : `${paneCount} panes`
}

/**
 * One row: what the buffer is called, how many panes hold it, and the control that ends it.
 *
 * THE RETIRE CONTROL CARRIES THE BUFFER'S NAME IN ITS ACCESSIBLE NAME, not just in the text beside it.
 * Every row's control reads `retire`, so a list of them announces as a column of identical buttons to
 * anyone who reaches them one at a time rather than seeing the row around them — and this is the one
 * gesture in the app that destroys a user's work irrecoverably.
 *
 * IT HIDES THE LIST BEFORE IT FIRES, in that order. `retire` rebinds the panes that were showing the
 * buffer and removes it from every selector, so the list this row sits in is stale the instant the
 * handler returns; dismissing first means no row is ever left on screen naming a buffer that has gone.
 * It also makes the next open a rebuild (see `bufferList`), which is what keeps the retired row from
 * coming back. `pane-chrome.ts`'s `splitControl` dismisses in the same order for the same reason.
 *
 * **RETIRE DISMISSES BECAUSE IT REMOVES THE ROW; A TEMPERATURE CLICK REBUILDS BECAUSE IT CHANGES ONE.**
 * After a retire there is nothing left for this row to show, so the paragraph above's "hide first" is
 * the honest outcome. After a `warm` or a `cool` the buffer is still here and has just changed the one
 * fact the row exists to report — `warm`, and everything this file derives from it: the asleep marker,
 * whether the term line appears, which of the two controls is offered. Dismissing here would be
 * dishonest in the other direction, and costly: cooling several buffers to get under the cap is a real
 * gesture (`ScratchBuffers.cool`'s own "retire or cool one" refusal message), and a dismiss-per-click
 * would turn three clicks into three open-click cycles. So the list STAYS OPEN on a temperature click
 * and `bufferList` rebuilds every row in place — through `rebuildRows`, shared with the `beforetoggle`
 * listener so the row-building logic is written once. See `bufferList`'s own doc for where that lives.
 */
const bufferRow = (
  row: BufferRow,
  menu: HTMLElement,
  onRetire: (id: SessionId) => void,
  onTemperature: (id: SessionId, warm: boolean) => void,
): { id: SessionId; el: HTMLElement; retire: HTMLButtonElement; temperature: HTMLButtonElement } => {
  const el = document.createElement('div')
  el.className = 'buffer-row'

  const name = document.createElement('span')
  name.className = 'buffer-row-name'
  // ` — asleep` JOINS THE ORPHAN MARKER RATHER THAN REPLACING OR DUPLICATING IT — the same mechanism
  // `paneReadout` already uses. NOT "CAN BE" AN ORPHAN TOO, WHICH IS WHAT THIS USED TO SAY — A COLD
  // BUFFER ALWAYS IS ONE: `cool` rebinds every pane bound to the buffer it sleeps (`ScratchBuffers.cool`'s
  // own doc), and `paneCount` counts panes still on the session, so a cold row's `paneReadout` can only
  // ever return `orphan`. Every cold row therefore reads `scratch N — orphan — asleep`, joining two
  // markers that are, for this one state, the same fact stated twice. The join stays anyway:
  // `paneReadout` is a general-purpose reader with no idea `warm` exists, and branching it on a fact
  // from a field it is not passed would tangle two concerns this file otherwise keeps apart. The row
  // still reads correctly, just not minimally — and minimality is not what this comment is fixing.
  name.textContent = `${row.label} — ${paneReadout(row.paneCount)}${row.warm ? '' : ' — asleep'}`

  /**
   * The buffer's term, under its name — see `BufferRow.term` for why a row without it is a column of
   * rows the user cannot tell apart.
   *
   * **TRUNCATED BY CSS AND NOT BY A SLICE HERE.** A `slice(0, 40)` would be a width written in this file
   * for a box whose width is in the stylesheet, wrong at every zoom level and every font size, and
   * wrong again the day `.buffer-list`'s `min-width` moves. `text-overflow: ellipsis` truncates at the
   * width the row actually has, and the full term stays in the DOM — so it is selectable, and a screen
   * reader gets the whole of it rather than the part that happened to fit.
   *
   * `title` CARRIES THE FULL TERM TOO, for the pointer user the ellipsis leaves guessing. `pane-chrome.ts`
   * states the same split for its own controls: the visible text is the glanceable half, the `title` is
   * the one that does not have to fit.
   *
   * THE ABSENT CASE IS A SENTENCE, NOT AN EMPTY LINE, and it deliberately does not guess WHY — **FOR A
   * WARM ROW.** A buffer with no term is one whose fork has not answered yet or one whose build failed,
   * and this row cannot tell those apart — `no term yet` is true of both, where "wedged" would be a
   * claim and "building…" would repeat the very lie a phantom-forked pane already tells (deferred-a11y
   * item 11's neighbourhood). It takes a class of its own so the stylesheet can mark it without this
   * file choosing a colour.
   *
   * A COLD ROW GETS NEITHER THE SENTENCE NOR THE EMPTY LINE — IT GETS NO LINE — which is why this
   * element is built unconditionally but only ever appended below when `row.warm`. `BufferRow.warm`'s
   * own doc has the reason: a cold buffer's `term` is null for a different fact than a warm one's, and
   * `no term yet` under a name already reading `— asleep` would be this row lying about which fact it
   * is.
   */
  const term = document.createElement('span')
  term.className = row.term === null ? 'buffer-row-term is-absent' : 'buffer-row-term'
  term.textContent = row.term ?? 'no term yet'
  if (row.term !== null) term.title = row.term

  // THE TWO LINES ARE ONE FLEX CHILD, so the retire control stays at the row's trailing edge — the
  // column-to-aim-down `.buffer-row`'s own CSS comment argues for — rather than being pushed by
  // whichever line is longer. ONLY A WARM ROW GETS THE SECOND LINE, per the `term` comment above.
  const text = document.createElement('span')
  text.className = 'buffer-row-text'
  text.append(name)
  if (row.warm) text.append(term)

  const retire = document.createElement('button')
  retire.type = 'button'
  retire.className = 'buffer-retire'
  retire.textContent = 'retire'
  retire.title = `retire ${row.label}`
  retire.setAttribute('aria-label', `retire ${row.label}`)
  retire.addEventListener('click', () => {
    menu.hidePopover()
    onRetire(row.id)
  })

  const temperature = document.createElement('button')
  temperature.type = 'button'
  temperature.className = 'buffer-temperature'
  // ADDED AND REMOVED, NEVER DISABLED — `pane-chrome.ts`'s stated idiom, and the same standard: a
  // control that provably cannot work should not be offered. There is no `cool` for a cold buffer.
  temperature.textContent = row.warm ? 'cool' : 'warm'
  // NAMES THE BUFFER, MIRRORING `retire` THREE LINES BELOW AND FOR ITS STATED REASON: every row's
  // temperature control otherwise reads the same two words, so a screen-reader user stepping through
  // them by role hears `warm, cool, cool, warm, …` with nothing to tell one buffer's control from
  // another's — on the one surface that can reach a buffer no pane is showing. `title` carries the same
  // string for the pointer user, the split `retire` and the term span both already use.
  const temperatureName = `${row.warm ? 'cool' : 'warm'} ${row.label}`
  temperature.title = temperatureName
  temperature.setAttribute('aria-label', temperatureName)
  temperature.addEventListener('click', () => onTemperature(row.id, !row.warm))

  el.append(text, temperature, retire)
  // **THE RETIRE BUTTON IS HANDED BACK RATHER THAN LEFT TO BE FOUND AGAIN**, which is what lets the
  // caller's `autofocus` line read exactly like `pane-chrome.ts`'s `splitControl`: one value, one
  // absent-ness, `if (first !== undefined)`. It was `items[0]?.querySelector('button')` — a value that
  // could be missing in two different ways (no row, or a row with no button), needing `first !== null
  // && first !== undefined` to narrow, where the second way cannot happen because this function builds
  // the retire button three lines up.
  //
  // **RETIRE, NOT TEMPERATURE, EVEN THOUGH THE ROW NOW BUILDS TWO BUTTONS AND TEMPERATURE COMES FIRST
  // IN DOM ORDER.** This field is what `bufferList` sets `autofocus` on for the first row the instant
  // the list opens, so it is also the choice of which control catches a keyboard user's focus before
  // either has been read — a choice that used to be the only one on offer and is deliberate now that it
  // is not. It stays retire: a buffer with no pane is unreachable any other way, and `bufferList`'s own
  // "WHY IT EXISTS AT ALL" doc names retire, not temperature — which arrived a task later — as the
  // reason this list exists. DOM order states which control a sighted user meets first reading left to
  // right; it says nothing about which one a keyboard user should land on first, and here the two answers differ.
  //
  // **`temperature` AND `id` ARE HANDED BACK TOO, AS OF 5d-ii-d review round 2, Finding 1.** A
  // temperature click rebuilds every row (`rebuildRows`) rather than dismissing the popover the way
  // `retire` does, which destroys the very button the click landed on; `handleTemperature` below needs
  // this row's freshly-built `temperature` button to hand focus back to it, and `id` to find THIS row
  // again among the rebuilt items rather than trusting its position to be unchanged. See
  // `handleTemperature`'s own doc for the fix in full.
  return { id: row.id, el, retire, temperature }
}

/**
 * The header bar's buffer list — the only surface that can reach a buffer no pane is showing.
 *
 * **WHY IT EXISTS AT ALL.** A scratch buffer outlives the panes bound to it and survives a recompile
 * (design §4.3), so closing the last pane showing one leaves it running with no pane chrome anywhere
 * able to name it. This list is the only route to such a buffer, and — since a poisoned worker no
 * longer dies on recompile (§4.4) — the only escape from one that has wedged. That is why it ships in
 * the same slice that makes buffers plural rather than after it: N buffers with no retire control
 * would remove a safety mechanism and offer nothing in its place.
 *
 * **NO CONFIRMATION DIALOG, AND THAT IS A DECISION RATHER THAN AN OMISSION (§4.2).** Retiring destroys
 * work, so it is the decision here most worth arguing with. Against a dialog: the gesture is already
 * two deliberate acts — open the list, aim at one row — and a modal would be the first in this app,
 * bringing focus-trap semantics into a slice whose accessibility budget is spent on making this list
 * keyboard-operable. For the safeguard instead: `BufferRow.paneCount` makes retiring a buffer with
 * live panes look different from reclaiming an orphan BEFORE the click rather than after it.
 *
 * **IT TAKES A BUTTON RATHER THAN BUILDING ONE.** The header bar is `index.html`'s markup and its
 * controls are queried by `main.ts`, exactly as `#appearance` and `#restore-layout` are; a function
 * that minted its own button would have to be told where to put it, which is the one thing the page
 * already says. It follows that the button must be IN THE DOCUMENT when this is called — the popover
 * is inserted beside it, and a popover that is not connected cannot be shown.
 *
 * THE POPOVER GOES BESIDE THE BUTTON, NOT ON `document.body`, for `splitControl`'s reason: whatever
 * removes the control takes its list with it, so there is nothing to sweep and no way to leave a
 * detached menu in the top layer.
 *
 * NATIVE `popover`, NOT A HAND-ROLLED DROPDOWN — the idiom `pane-chrome.ts`'s `splitControl` settled
 * one slice ago. Light dismiss, top-layer placement and Escape come with the attribute; a hand-rolled
 * menu needs a document-level listener that has to be removed when the control goes away, plus a
 * z-index negotiation with the dividers `layout-view.ts` draws. The anchor is the button and it is
 * IMPLICIT: a popover shown by its invoker takes that invoker as its anchor element, so `style.css`'s
 * `position-area` resolves against it with no `anchor-name` to mint and no JS to position anything.
 *
 * THE ROWS ARE BUILT ON `beforetoggle`, WHICH IS WHY `rows` IS A THUNK. A closed list has no state to
 * keep fresh — a stronger position than keeping it fresh cheaply — and the rows change under gestures
 * (a fork, a retire, a pane closing) rather than on a clock, so there is no frame on which rebuilding
 * would be right. A list handed a VALUE at construction is the one thing build-on-open cannot repair.
 *
 * **`beforetoggle` IS NO LONGER THE ONLY TRIGGER.** A temperature click rebuilds too, through the same
 * `rebuildRows` this listener calls — `bufferRow`'s own doc has the argument for why that gesture
 * rebuilds the open list in place instead of dismissing it the way `retire` does. The thunk argument
 * above still holds for both callers: rows are read fresh from `rows()` every time, never cached across
 * either trigger.
 *
 * **`update` TAKES A COUNT INSTEAD OF READING `rows().length`, AND THE TWO ARE ON DIFFERENT CLOCKS.**
 * The button's readout has to be current while the list is CLOSED, which is the state the thunk is
 * never called in; a readout derived from `rows()` would have to call it on whatever path repaints the
 * header, putting back exactly the cost build-on-open removes. The caller already knows the count at
 * the moment it changes, which is the only moment the readout can be wrong.
 *
 * `aria-expanded` IS SET AT CONSTRUCTION AND ON BOTH EDGES OF THE TOGGLE. A disclosure that only gains
 * the attribute once it has been used announces itself as a plain button to the one reader who most
 * needs to know it opens something, and one that never clears it goes on announcing an open list after
 * a light dismiss or Escape — neither of which passes through any handler of ours.
 *
 * **THE FIRST ROW'S CONTROL IS `autofocus`, NOT `.focus()`, AND THE DIFFERENCE IS THAT ONE OF THEM
 * WORKS.** The rows are built in `beforetoggle`, which fires BEFORE the popover is shown: the element
 * is still `display: none` there, and `.focus()` on a hidden element is a silent no-op. The popover's
 * show algorithm runs its focusing steps after making it visible and honours `autofocus` on a
 * descendant, which is the one hook that lands inside the same synchronous show. This was found the
 * hard way in the slice that built `splitControl`.
 */
export function bufferList(
  button: HTMLButtonElement,
  rows: () => readonly BufferRow[],
  onRetire: (id: SessionId) => void,
  onTemperature: (id: SessionId, warm: boolean) => void,
): { update(count: number): void } {
  const id = `buffer-list-${listSeq++}`
  const menu = document.createElement('div')
  menu.className = 'buffer-list'
  menu.id = id
  menu.popover = 'auto'

  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-controls', id)
  button.setAttribute('aria-expanded', 'false')
  // THE INVOKER RELATIONSHIP IS THE ENTIRE OPEN HANDLER — there is deliberately no `click` listener on
  // this button, so nothing races the popover's own activation behaviour, and it is also what makes the
  // button the list's implicit anchor element.
  button.popoverTargetElement = menu
  button.after(menu)

  /**
   * Builds every row fresh from `rows()` and swaps them into the menu — the one piece of logic
   * `beforetoggle` and a temperature click both need, kept in one place so it is never written twice
   * (5d-ii-d review, Finding 1). Returns the built items so `beforetoggle` can still reach into the
   * first one for `autofocus`, and so `handleTemperature` below can reach into the clicked buffer's own
   * item to move focus back onto it after the rebuild — see `handleTemperature`'s own doc for why
   * (5d-ii-d review round 2, Finding 1).
   */
  const rebuildRows = (): {
    id: SessionId
    el: HTMLElement
    retire: HTMLButtonElement
    temperature: HTMLButtonElement
  }[] => {
    const items = rows().map((row) => bufferRow(row, menu, onRetire, handleTemperature))
    menu.replaceChildren(...items.map((i) => i.el))
    return items
  }

  /**
   * Wraps the caller's `onTemperature` rather than passing it to `bufferRow` directly: the caller's job
   * is to change the fact (warm or cool the buffer), and this module's is to redraw the list around
   * that change once the caller's handler returns — `bufferRow`'s doc has the argument for why that
   * redraw is a rebuild rather than the dismiss `onRetire` gets below.
   *
   * **AND TO MOVE FOCUS BACK ONTO THE ROW THE CLICK CAME FROM (5d-ii-d review round 2, Finding 1).**
   * `rebuildRows`'s `menu.replaceChildren` destroys the button the click just landed on — and that held
   * focus — building a fresh one in its place; nothing downstream of that put focus anywhere, so it fell
   * to `<body>` inside a popover that (correctly, per `bufferRow`'s own doc) never closes on a
   * temperature click. `retire` does not have this problem: it calls `menu.hidePopover()` first, and the
   * popover's own hide algorithm hands focus back to the invoker when focus was inside it (`main.ts`'s
   * `refreshBuffers` doc has that mechanism spelled out) — a temperature click never closes the popover,
   * so that mechanism never runs. This is the deferred-accessibility list's item 1, *"a control that
   * hides itself on click strands the keyboard,"* reached here by a rebuild instead of a hide, and its
   * own stated remedy is exactly this: move focus deliberately rather than start disabling things.
   *
   * MATCHED BY `id`, NOT BY POSITION. `rebuildRows` returns fresh items in `rows()`'s current order,
   * which can reorder or drop a row if a buffer ended concurrently between the click and the rebuild;
   * `id` is the one thing about a row `onTemperature` already receives untouched, so it is what survives
   * the rebuild to find the same row again.
   *
   * `.focus()`, NOT `autofocus`. `autofocus` is honoured by the popover's SHOW algorithm — the mechanism
   * `bufferList`'s own doc uses for the first row on open — and the popover here is already shown, so
   * setting the attribute would be a flag nothing is left to act on. `.focus()` works precisely because
   * the target is visible right now, the inverse of the reason `bufferList`'s doc gives for why
   * `beforetoggle` cannot use it.
   */
  const handleTemperature = (id: SessionId, warm: boolean): void => {
    onTemperature(id, warm)
    const items = rebuildRows()
    const mine = items.find((item) => item.id === id)
    if (mine !== undefined) {
      mine.temperature.focus()
    } else {
      // DEFENSIVE, SHOULD NOT HAPPEN: only `retire` removes a buffer (`bufferRow`'s own doc), so `id`
      // should always survive its own rebuild. If it somehow does not, fall back to the invoker button
      // rather than leave focus on `<body>` — `button` is guaranteed present (a constructor argument,
      // not something built from `rows()`) and is where `main.ts`'s `refreshBuffers` sends focus for
      // the same "do not strand it" reason when a buffer disappears out from under this list.
      button.focus()
    }
  }

  menu.addEventListener('beforetoggle', (e) => {
    const open = e.newState === 'open'
    button.setAttribute('aria-expanded', String(open))
    if (!open) return
    const items = rebuildRows()
    // AFTER `replaceChildren`, AND ON THE ROW RATHER THAN THE LIST. `autofocus` is honoured on a
    // descendant of the popover being shown; setting it on a node that is not yet in the list would be
    // a flag on an element the show algorithm never walks.
    const first = items[0]
    if (first !== undefined) first.retire.autofocus = true
  })

  return {
    /** Refresh the button's own readout — design §4.2's `[buffers 3 ▾]`. */
    update(count: number) {
      button.textContent = `buffers ${count} ▾`
    },
  }
}
