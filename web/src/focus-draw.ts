/**
 * **A FOCUS MOVE MADE DURING A POINTER PRESS IS DRAWN ONCE THE PRESS HAS ENDED, AFTER ITS CLICK; ANY OTHER IS DRAWN AT
 * ONCE.** A press's `mousedown` is what moves the focus into the view it lands on, and the frame that focus move draws
 * can change the page's layout: the strip's readout takes another number of lines for another view, and the inspector
 * stacked under the views another height. A control low in a view would then be drawn somewhere else between the press
 * and its release, the release would not be on it, and the browser would send the click to an element holding both,
 * so the first press on a control in another view would be lost. A focus move with no press around it — Tab, the view
 * keys, a `focus()` from code — has no click to lose, and draws at once.
 *
 * **ONE PRESS STATE FOR THE PAGE, AND THIS IS ITS OWNER.** `main.ts` builds one and hands the function it returns to
 * each `focusin` listener that draws, the source view's own and `pane-host.ts`'s `hostFor`'s, so no two of them can
 * disagree about whether a press is in progress.
 *
 * **A PRESS BEGINS AT `pointerdown` OR `mousedown` AND ENDS AT THE `pointerup` OR `mouseup` AFTER IT**, both pairs.
 * **THE MOUSE PAIR HOLDS A TAP'S FOCUS MOVE**: a tap fires its `pointerup` before the `mousedown` whose default moves
 * the focus, so that focus move is inside the mouse pair alone. **THE POINTER PAIR HOLDS A FOCUS MOVE THAT CODE MAKES
 * WHILE A FINGER IS HELD DOWN**: a touch fires its `pointerdown` at the touch and a tap's `mousedown` only after the
 * lift, so through the hold only the pointer pair has begun the press; so too through a press whose `pointerdown`
 * default is prevented, which no `mousedown` or `mouseup` follows.
 *
 * **A PRESS ON A `<select>` BEGINS NONE.** The `<select>` opens its list at the press, in a popup that can take the
 * release: a press dragged into the popup and released there may send this page no release, and none of the early
 * ends below either. Nothing waits on that release, since the list is open already, so a focus move the press makes
 * draws at once.
 *
 * **EVERY PRESS ENDS, OR EVERY LATER FOCUS MOVE GOES UNDRAWN**, a keyboard's too, until some later press happens to
 * end. So a press also ends where its release may never reach this page: at `pointercancel`, which ends a press the
 * browser takes over, with no `pointerup` after it; at `contextmenu`, whose menu may take the release; and at the
 * window's own `blur`, after which the release may go to the window that took the focus. **AN EARLY END QUEUES THE
 * OWED DRAW THERE, AND A RELEASE CAN STILL FOLLOW IT**: after the window's `blur` the release may still reach this
 * page, and with two pointers down at once the first one's release ends the press while the other is still held. So
 * the frame can still move a control from under a release still to come, and a focus move later in the press draws at
 * once.
 *
 * **THE OWED DRAW IS A TASK OF ITS OWN, QUEUED AT THE PRESS'S END**: the browser fires a release's `pointerup`,
 * `mouseup` and `click` in one task, so a draw queued at the release runs after the click has landed, and outside any
 * `focusin`.
 *
 * **ONLY THE FOCUS MOVE'S OWN DRAW WAITS.** A frame drawn for another reason while the press is held, a playing run's
 * next step among them, draws the new focus all the same, and moves the control with it.
 */
export function createFocusDraw(draw: () => void): () => void {
  let pressing = false
  let owed = false
  const begin = (e: Event): void => {
    if (e.target instanceof Element && e.target.closest('select') !== null) return
    pressing = true
  }
  const end = (): void => {
    if (!pressing) return
    pressing = false
    if (!owed) return
    owed = false
    setTimeout(draw, 0)
  }
  // ON THE WINDOW AND CAPTURING: a press has begun before any handler on its target runs, and before the `mousedown`'s
  // default moves the focus; and no handler that stops an event's propagation can hide a press's beginning or end.
  for (const type of ['pointerdown', 'mousedown']) window.addEventListener(type, begin, { capture: true })
  for (const type of ['pointerup', 'mouseup', 'pointercancel', 'contextmenu'])
    window.addEventListener(type, end, { capture: true })
  // THE WINDOW'S OWN `blur`, NOT AN ELEMENT'S: an element's reaches this capturing listener too, and the press's own
  // focus move blurs the element it leaves, which would end every press at the moment it moves the focus.
  window.addEventListener(
    'blur',
    (e) => {
      if (e.target === window) end()
    },
    { capture: true },
  )
  return () => {
    if (pressing) owed = true
    else draw()
  }
}
