import type { Leg } from './protocol'
import type { SessionId } from './session-client'

/**
 * One scratch buffer, as the header list renders it.
 *
 * **`paneCount` IS A NUMBER AND NOT AN `orphan: boolean`, WHICH IS THE WHOLE SHAPE OF THIS TYPE.**
 * Design §4.2 refuses a confirmation dialog for retire and puts the row's own information in its
 * place: retiring a buffer two panes are showing has to LOOK different from reclaiming one nothing is
 * showing, before the click rather than after it. A boolean would collapse "some panes are bound" into
 * one word and leave the user with the same row text for both of the cases the safeguard exists to
 * tell apart. The *not shown* marker is then derived rather than carried — one fact, rendered two ways.
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
   * to do so. `label` is `λ copy N` or `TM copy N` BY CONSTRUCTION (`#minted` only counts up, and
   * the leg picks the prefix — `ScratchBuffers`'s own doc in `scratch.ts`), so no amount of naming fixes
   * this: the distinguishing fact is what the buffer HOLDS.
   *
   * `string | null` RATHER THAN AN EMPTY STRING FOR THE ABSENT CASE, because the two are different
   * things the row says differently: a buffer whose fork has not answered yet, or never will, has no
   * term — where a buffer holding the empty term is not a state the worker can produce. The renderer
   * marks the absent case rather than drawing a blank line, since a blank line under a name reads as a
   * rendering fault rather than as a fact about the buffer.
   *
   * THAT MARKING IS NOW SCOPED TO A WARM ROW, since `warm` below split `null` into two facts this field
   * alone cannot tell apart. A cold buffer's `term` is null too, but `bufferRow` does not draw a line
   * for it at all — the row is already marked *paused* on its name line, and a second line reading `no
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
   * reads as a fault where *paused* reads as a state.
   */
  readonly warm: boolean
  /** The copy's leg, which its name is said with. */
  readonly leg: Leg
}

/**
 * Unique ids for the popovers, so `aria-controls` on a list button names exactly one element.
 *
 * A COUNTER RATHER THAN A FIXED STRING, EVEN THOUGH THE HEADER BAR IS ONE. `view-header.ts`'s
 * `viewMenu`'s `viewMenuSeq` needs one because views are plural; this function needs one because nothing in its
 * signature makes the singleton true, and two calls in one document would mint the same id twice —
 * which is precisely the thing an id reference cannot survive, and which fails silently.
 */
let listSeq = 0

/**
 * How a row states how many views show the copy, or that none do.
 *
 * *not shown* REPLACES THE COUNT RATHER THAN JOINING IT (5d-ii-c design §4.2 settled the shape, as "its
 * pane count **or** `— orphan`"; spec §12 renames the word). "0 views — not shown" says one fact twice,
 * and the zero case is the one that needs a word rather than a number: it is the state that makes this
 * whole control necessary, since a copy no view is showing has no chrome anywhere else to reach it.
 *
 * THE SINGULAR IS SPELLED OUT because the list's job is to be read at a glance under a gesture that
 * destroys work, and "1 views" is the kind of seam that makes a reader stop trusting the rest of the row.
 */
const viewReadout = (paneCount: number): string => {
  if (paneCount === 0) return 'not shown'
  return paneCount === 1 ? '1 view' : `${paneCount} views`
}

/**
 * One row: what the copy is called, how many views hold it, and the control that ends it.
 *
 * THE DELETE CONTROL CARRIES THE COPY'S NAME IN ITS ACCESSIBLE NAME, not just in the text beside it.
 * Every row's control reads `delete`, so a list of them announces as a column of identical buttons to
 * anyone who reaches them one at a time rather than seeing the row around them — and this is the one
 * gesture in the app that destroys a user's work.
 *
 * **IT LEAVES THE LIST OPEN AND IS REBUILT AROUND, WHERE IT USED TO DISMISS FIRST (spec §11).** A
 * delete rebinds the views that were showing the copy and removes it from every selector, so the row
 * this builds is stale the instant the handler returns — but hiding the list to deal with that took
 * focus with it, and §11 is categorical that focus never falls to `<body>`. `handleDelete` below
 * rebuilds every row in place and moves focus to the delete control of the row that takes this one's
 * index, else the one before it, else the invoking button once nothing is left. No row is ever left on
 * screen naming a copy that has gone, and the keyboard keeps its place in the list.
 *
 * **BOTH GESTURES REBUILD NOW, AND THE TEMPERATURE CLICK IS THE ONE THAT ALWAYS DID.** After a delete
 * there is nothing left for this row to show, so the rebuild drops it; after a `warm` or a `cool` the
 * buffer is still here and has just changed the one fact the row exists to report — `warm`, and
 * everything this file derives from it: the *paused* marker, whether the term line appears, which of
 * the two controls is offered. Dismissing on a temperature click would be dishonest, and costly:
 * pausing several copies to get under the cap is a real gesture (`ScratchBuffers.cool`'s own
 * "pause or delete one" refusal message), and a dismiss-per-click would turn three clicks into three
 * open-click cycles. Both paths go through `rebuildRows`, shared with the `beforetoggle` listener so
 * the row-building logic is written once. See `bufferList`'s own doc for where that lives.
 */
const bufferRow = (
  row: BufferRow,
  onRetire: (id: SessionId) => void,
  onTemperature: (id: SessionId, warm: boolean) => void,
): { id: SessionId; el: HTMLElement; retire: HTMLButtonElement; temperature: HTMLButtonElement } => {
  const el = document.createElement('div')
  el.className = 'buffer-row'

  const name = document.createElement('span')
  name.className = 'buffer-row-name'
  // `· paused` JOINS THE *not shown* MARKER RATHER THAN REPLACING OR DUPLICATING IT — the same mechanism
  // `viewReadout` already uses. NOT "CAN BE" UNSHOWN TOO, WHICH IS WHAT THIS USED TO SAY — A COLD
  // BUFFER ALWAYS IS: `cool` rebinds every pane bound to the buffer it sleeps (`ScratchBuffers.cool`'s
  // own doc), and `paneCount` counts panes still on the session, so a cold row's `viewReadout` can only
  // ever return `not shown`. Every cold row therefore reads `λ copy N · not shown · paused`, joining two
  // markers that are, for this one state, the same fact stated twice. The join stays anyway:
  // `viewReadout` is a general-purpose reader with no idea `warm` exists, and branching it on a fact
  // from a field it is not passed would tangle two concerns this file otherwise keeps apart. The row
  // still reads correctly, just not minimally — and minimality is not what this comment is fixing.
  const said = `${row.leg === 'lambda' ? 'λ' : 'TM'} ${row.label}`
  name.textContent = `${said} · ${viewReadout(row.paneCount)} · ${row.warm ? 'running' : 'paused'}`

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
   * `no term yet` under a name already reading `· paused` would be this row lying about which fact it
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

  // DELETE KEEPS THE LIST OPEN, WHERE IT USED TO HIDE IT FIRST (Plan 7 part 2 spec §11). The list is
  // rebuilt around the delete — `bufferList`'s `handleDelete` — so a row naming a deleted copy is never
  // left on screen; and keeping the list open is what lets focus land on the next row rather than on
  // `<body>`.
  const retire = document.createElement('button')
  retire.type = 'button'
  retire.className = 'buffer-delete'
  retire.textContent = 'delete'
  retire.title = `delete ${said}`
  retire.setAttribute('aria-label', `delete ${said}`)
  retire.addEventListener('click', () => onRetire(row.id))

  const temperature = document.createElement('button')
  temperature.type = 'button'
  temperature.className = 'buffer-temperature'
  // ADDED AND REMOVED, NEVER DISABLED — `pane-chrome.ts`'s stated idiom, and the same standard: a
  // control that provably cannot work should not be offered. There is no `cool` for a cold buffer.
  temperature.textContent = row.warm ? 'pause' : 'resume — restarts at step 0'
  // NAMES THE BUFFER, MIRRORING `retire` THREE LINES BELOW AND FOR ITS STATED REASON: every row's
  // temperature control otherwise reads the same two words, so a screen-reader user stepping through
  // them by role hears `warm, cool, cool, warm, …` with nothing to tell one buffer's control from
  // another's — on the one surface that can reach a buffer no pane is showing. `title` carries the same
  // string for the pointer user, the split `retire` and the term span both already use.
  const temperatureName = row.warm ? `pause ${said}` : `resume ${said} — restarts at step 0`
  temperature.title = temperatureName
  temperature.setAttribute('aria-label', temperatureName)
  temperature.addEventListener('click', () => onTemperature(row.id, !row.warm))

  el.append(text, temperature, retire)
  // **THE RETIRE BUTTON IS HANDED BACK RATHER THAN LEFT TO BE FOUND AGAIN**, which is what lets the
  // caller's `autofocus` line read exactly like `view-header.ts`'s `viewMenu`: one value, one
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
  // temperature click rebuilds every row (`rebuildRows`) in the open list, which destroys the very
  // button the click landed on; `handleTemperature` below needs this row's freshly-built `temperature`
  // button to hand focus back to it, and `id` to find THIS row again among the rebuilt items rather
  // than trusting its position to be unchanged. `handleDelete` does the same with the `retire` button
  // of the row that takes this one's index — it has nowhere to hand focus back TO. See
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
 * live views look different from reclaiming one nothing is showing BEFORE the click rather than after it.
 *
 * **IT TAKES A BUTTON RATHER THAN BUILDING ONE.** The header bar is `index.html`'s markup and its
 * controls are queried by `main.ts`, exactly as `#appearance` and `#reset-preset` are; a function
 * that minted its own button would have to be told where to put it, which is the one thing the page
 * already says. It follows that the button must be IN THE DOCUMENT when this is called — the popover
 * is inserted beside it, and a popover that is not connected cannot be shown.
 *
 * THE POPOVER GOES BESIDE THE BUTTON, NOT ON `document.body`, for `viewMenu`'s reason: whatever
 * removes the control takes its list with it, so there is nothing to sweep and no way to leave a
 * detached menu in the top layer.
 *
 * NATIVE `popover`, NOT A HAND-ROLLED DROPDOWN — the idiom `view-header.ts`'s `viewMenu` settled
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
 * **`beforetoggle` IS NO LONGER THE ONLY TRIGGER.** A temperature click and a delete both rebuild too,
 * through the same `rebuildRows` this listener calls — `bufferRow`'s own doc has the argument for why
 * each rebuilds the open list in place rather than dismissing it. The thunk argument
 * above still holds for all three callers: rows are read fresh from `rows()` every time, never cached across
 * any trigger.
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
 * hard way in the slice that built `viewMenu`.
 */
export function bufferList(
  button: HTMLButtonElement,
  rows: () => readonly BufferRow[],
  onRetire: (id: SessionId) => void,
  onTemperature: (id: SessionId, warm: boolean) => void,
  onNewTm: () => void,
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
   *
   * **THE *new TM copy* CONTROL IS BUILT HERE TOO, FIRST, AHEAD OF EVERY ROW — 5d-iv T10, design §4.7.**
   * "GIVE ME SOMEWHERE TO PASTE A `.tm` FILE" is a different intention from *edit a copy*, which detaches a view
   * onto a copy of what it was showing — there is no view to seed a TM copy FROM (`ScratchBuffers.
   * forkBlank`'s own doc), and above the cap that gesture is unavailable where this one never is. It
   * lives here rather than in the app header because this menu is where copies are managed, and it is
   * what makes the menu non-empty at zero — which is why `main.ts`'s `refreshBuffers` no longer hides the
   * invoking button. IT IS BUILT INSIDE `rebuildRows`, NOT ONCE AT CONSTRUCTION, so a temperature click's
   * `menu.replaceChildren` (this function's own next line) does not delete it out from under a still-open
   * list — the same reason every row is rebuilt here rather than patched in place. FIRST, so a keyboard
   * user tabbing into the list reaches it before a row list that may be long, rather than after.
   */
  const rebuildRows = (): {
    id: SessionId
    el: HTMLElement
    retire: HTMLButtonElement
    temperature: HTMLButtonElement
  }[] => {
    const newTm = document.createElement('button')
    newTm.type = 'button'
    newTm.className = 'new-tm'
    newTm.textContent = 'new TM copy'
    newTm.addEventListener('click', () => {
      menu.hidePopover()
      onNewTm()
    })
    const items = rows().map((row) => bufferRow(row, handleDelete, handleTemperature))
    menu.replaceChildren(newTm, ...items.map((i) => i.el))
    return items
  }

  /**
   * Wraps the caller's `onRetire` — delete a copy, rebuild the list around it, and put focus on the delete
   * control of the row now at the same index, else the one before it. With no rows left the list closes
   * and focus goes to the button (spec §11: focus never falls to `<body>`).
   */
  const handleDelete = (id: SessionId): void => {
    const index = rows().findIndex((r) => r.id === id)
    onRetire(id)
    const items = rebuildRows()
    const next = items[index] ?? items[index - 1]
    if (next !== undefined) {
      next.retire.focus()
      return
    }
    menu.hidePopover()
    button.focus()
  }

  /**
   * Wraps the caller's `onTemperature` rather than passing it to `bufferRow` directly: the caller's job
   * is to change the fact (warm or cool the buffer), and this module's is to redraw the list around
   * that change once the caller's handler returns — `bufferRow`'s doc has the argument for why that
   * redraw is a rebuild in the open list, which `handleDelete` above now shares.
   *
   * **AND TO MOVE FOCUS BACK ONTO THE ROW THE CLICK CAME FROM (5d-ii-d review round 2, Finding 1).**
   * `rebuildRows`'s `menu.replaceChildren` destroys the button the click just landed on — and that held
   * focus — building a fresh one in its place; nothing downstream of that put focus anywhere, so it fell
   * to `<body>` inside a popover that (correctly, per `bufferRow`'s own doc) never closes on a
   * temperature click. A delete used to dodge this by calling `menu.hidePopover()` first, so the
   * popover's own hide algorithm handed focus back to the invoker when focus was inside it (`main.ts`'s
   * `refreshBuffers` doc has that mechanism spelled out); spec §11 wants the next ROW instead, so
   * `handleDelete` now stays open and places focus itself, exactly as this does. This is the
   * deferred-accessibility list's item 1, *"a control that
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
    /**
     * Refresh the button's own readout — Plan 7 part 2's `copies 3 ▾`.
     *
     * **`copies ▾`, WITHOUT THE `0`, AT ZERO — 5d-iv T10.** Every other count is the honest answer to
     * "how many buffers exist"; zero used to be too, but the menu this button opens is no longer empty
     * at zero (`rebuildRows`'s "new TM copy" control, above) and a `0` in front of a control that is
     * about to open something readable would misstate the one thing a count is for.
     *
     * **THE `▾` IS HIDDEN FROM THE ACCESSIBLE NAME, AND THE CONTROLS GATE IS WHAT FOUND THAT IT WAS NOT.**
     * The name is built from the button's text, so a bare `▾` made it `copies 1 ▾` — and a screen reader
     * says that character out, by its Unicode name. The count is what this readout exists to say
     * (`main.ts`'s own note on why the button carries no `aria-label`), so the caret is decoration and
     * declares itself as such; `aria-haspopup`/`aria-expanded` are what announce that it opens a menu.
     */
    update(count: number) {
      const caret = document.createElement('span')
      caret.setAttribute('aria-hidden', 'true')
      caret.textContent = ' ▾'
      button.replaceChildren(document.createTextNode(count === 0 ? 'copies' : `copies ${count}`), caret)
    },
  }
}
