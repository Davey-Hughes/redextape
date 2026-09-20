/**
 * WHERE THE FOCUS GOES WHEN A CONTROL IS TAKEN AWAY UNDER IT — Plan 7 part 2 spec §11's fourth rule.
 *
 * **A CONTROL REMOVED BY ITS OWN CLICK IS NOT THIS.** A menu item that closes its menu hands the focus back
 * to the menu's button, which the popover already does; a view closed by its own `✕` hands it to the view
 * that becomes focused. Those are gestures, and the gesture knows where the user is going. This is the
 * other case: a STATE CHANGE removes a control the user happens to be standing on — `continue` when a
 * recording ends, a view's split items when Stage is chosen, a view's step controls when the bar takes them
 * over, *reset preset* when a switch makes the workspace custom. There is no gesture to ask, so the rule
 * is positional: the nearest control that still works, in the same header or menu.
 *
 * **THE CANDIDATE LIST IS THE CALLER'S, AND `nearest` IS ONLY THE DEFAULT WAY TO BUILD ONE.**
 * `step-controls.ts` prefers *forward, play, back, restart*, then the speed select — an order that is
 * about what those controls MEAN, not where they sit, and DOM order would put the speed select first.
 * A single function computing the order for everyone would have had to be wrong for one of them.
 *
 * **NOT MOVING IS A RESULT, AND IT IS REPORTED.** With no usable candidate this leaves the focus where it
 * is and answers `false`. Blurring to `<body>` would be the failure the whole rule exists to prevent,
 * performed by the rule itself.
 */

/** Whether `el` can be focused right now: on the page, enabled, not inside anything `hidden`, in the tab order. */
function usable(el: Element | null | undefined): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.isConnected &&
    !el.matches(':disabled') &&
    el.closest('[hidden]') === null &&
    el.tabIndex >= 0
  )
}

/** Whether the focus is on `el` or on something inside it. */
function holdsFocus(el: Element): boolean {
  const active = document.activeElement
  return active !== null && (active === el || el.contains(active))
}

/**
 * Hand the focus on, if the departing control has it.
 *
 * Answers whether it moved: `false` both for "the focus was somewhere else" and for "there was nowhere to
 * put it", which are the two cases a caller has nothing further to do about.
 */
export function handOff(
  going: Element | readonly Element[],
  candidates: readonly (Element | null | undefined)[],
): boolean {
  const leaving = Array.isArray(going) ? (going as readonly Element[]) : [going as Element]
  if (!leaving.some(holdsFocus)) return false
  const next = candidates.find(usable)
  if (next === undefined) return false
  next.focus()
  return true
}

/**
 * The candidates §11's "nearest remaining control" names: forward from `going` to the end of `within`, then
 * backward from `going` to its start.
 *
 * **FORWARD FIRST, BECAUSE READING ORDER IS WHERE A USER EXPECTS TO LAND.** The control after the one that
 * vanished is the one they would have reached next by `Tab`; falling back to the one before it is what a
 * departing LAST control leaves.
 *
 * **`going`'s OWN DESCENDANTS ARE EXCLUDED.** A departing GROUP — a menu section, a header slot — is removed
 * with everything in it, so a candidate inside it is a control that is also about to go.
 *
 * **ORDER COMES FROM `compareDocumentPosition`, NOT FROM AN INDEX.** `going` need not itself be one of the
 * controls this walks — it is a whole slot at two of the call sites — so there is no position of it in the
 * list to index from.
 */
export function nearest(within: HTMLElement, going: Element): HTMLElement[] {
  const all = [...within.querySelectorAll<HTMLElement>('button, select, [tabindex]')].filter(
    (el) => el !== going && !going.contains(el),
  )
  const after = all.filter((el) => (going.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
  const before = all.filter((el) => (going.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) !== 0)
  return [...after.filter(usable), ...before.reverse().filter(usable)]
}
