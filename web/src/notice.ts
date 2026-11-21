/**
 * THE NOTICE LINE AND THE LIVE REGION — Plan 7 part 2 spec §11, and the notice float design for where it is drawn.
 *
 * **ONE VISIBLE NOTICE AT A TIME, AND ONE POLITE LIVE REGION FOR THE WHOLE APP.** Every refusal, every copy
 * change and every layout change is said here, once, in words: shown floating over the header (`floatInRun`), where
 * it moves nothing on the page, and written to a visually hidden `role="status"` element so a screen reader hears it.
 *
 * **A NEW NOTICE REPLACES THE OLD ONE, ACTION AND ALL.** A notice lasts `NOTICE_MS`, or until the next one;
 * an undo offered by a notice that has been replaced is gone with it (spec §10), unless the new one offers the
 * same action, whose button it keeps (`paint`). A condition that LASTS is not a notice at all — it is the
 * line's resting state (`rest`), which every notice shows over and which comes back when each one ends.
 *
 * **`announce` IS THE LIVE REGION ALONE**, for a sentence already on screen elsewhere: the readout's link
 * sentence, said when a link gesture changes it.
 */

/** How long a notice stays, in milliseconds (spec §10's "8 s"). */
export const NOTICE_MS = 8000

/**
 * How long a notice drawn in place of one whose action was just pressed takes clicks on its words, in milliseconds.
 * **A DOUBLE-CLICK'S SECOND CLICK LANDS WHERE THE ACTION WAS**, on the next notice's words, which otherwise pass it
 * through to the control under them (`settings`, under an undo at the header's end); 500 ms is the double-click
 * interval most systems default to.
 */
export const SECOND_CLICK_MS = 500

export type NoticeAction = {
  readonly label: string
  readonly run: () => void
  /**
   * Where the focus goes when this action's notice ends while the focus is on it — the action run, the notice
   * expired, or a notice with no action of its own drawn over it. `createNotices`'s own fallback when it names none.
   */
  readonly fallback?: () => HTMLElement | null
}

/**
 * One notice, as `notify` drew it. **ITS `dismiss` ENDS IT EARLY, BUT ONLY WHILE IT IS STILL THE ONE ON THE LINE**,
 * and ends it as its own timer would: the line goes back to its resting sentence, or empties, and a focus the notice
 * held goes to its action's fallback. Once the notice has expired, been drawn over by another, or been ended by its
 * own action or an earlier `dismiss`, `dismiss` does nothing — so a caller may keep one and call it at any time, as
 * often as it likes, without ending what another gesture has said since. That is the whole contract: nothing else is
 * on it, and nothing reports whether a call acted.
 *
 * `main.ts`'s base16 import keeps the one a palette removal drew, so the next import ends that removal's *undo*, and
 * an undo never writes an old half over a newer import (Plan 7 part 6b spec §8.5). `replies.ts` keeps the one saying a
 * copy did not build, and ends it when a build of that copy lands.
 */
export type Notice = { dismiss(): void }

export type Notices = {
  /**
   * Show `text` on the line, with `action`'s button if there is one, until `NOTICE_MS` passes or the next notice
   * replaces it, and say it in the live region. Returns the `Notice`, for a caller that may need to end it early.
   */
  notify(text: string, opts?: { readonly action?: NoticeAction }): Notice
  announce(text: string): void
  /**
   * End the notice that is up now and put `rest` back under it.
   *
   * **ON THE SHAPE, BUT NOTHING OUTSIDE THIS MODULE CALLS IT — said here rather than left to be
   * discovered.** `createNotices` reaches its own `dismiss` from the `NOTICE_MS` timer, from an action
   * button, which must tear the notice down before running the action (a second undo would throw), and
   * from a `Notice`'s own `dismiss`. None of those needs the member. It is on the type so that "end this
   * one early" has a name a caller can find, instead of `rest(null)`, which clears the RESTING condition
   * and is a different thing entirely. No other module in `src/` and no test drives it — which is worth
   * one line, so the next reader does not go hunting for the caller. A caller ending ITS OWN notice holds
   * the `Notice` `notify` returns.
   */
  dismiss(): void
  /**
   * What the line says when no notice is up — Plan 7 part 2 spec §11's one lasting condition, *copies are
   * not being saved*.
   *
   * **A RESTING STATE RATHER THAN A NOTICE THAT NEVER EXPIRES, BECAUSE A NOTICE IS REPLACED.** A
   * persistent notice still goes the moment anything else is said, and nearly every gesture says
   * something — a copy created, a view closed. The condition it describes lasts, so the line returns to
   * it: every other notice shows over it for its `NOTICE_MS`, and when that one goes, this comes back.
   * `null` clears it, which is what a write that succeeds does. It offers `hide`, which takes it off the line until
   * the condition says something else.
   */
  rest(text: string | null): void
}

/**
 * **THE NOTICE FLOATS IN THE HEADER'S EMPTY RUN WHERE IT FITS, AND AT THE HEADER'S INLINE END WHERE IT DOES NOT** — the
 * notice float design. `run` is the header's spacer. A wider notice ends on the row of the header's last control,
 * `settings`, wherever the header wraps it, and grows over the controls after the run, so its action lies over
 * `settings` and not over `share` or a control before the run that a user may be on.
 * **THE PLACE IS KEPT WHILE THE SAME WORDS' ELEMENT IS REWRITTEN**: `paint` keeps the button for the same action, so a
 * press held across the redraw must still be on it at the release. The header and its controls are observed for size,
 * every way the run moves; the line only for its words, as a size observer that changes what it observes loops.
 * Fixed to the window: on a page scrolled down, it stays in sight.
 */
export function floatInRun(line: HTMLElement, run: HTMLElement): void {
  const header = run.parentElement as HTMLElement
  /** The header's last control in its flow, `settings`: its menus are popovers, out of the flow. */
  const last = [...header.children].findLast((c) => c !== line && !c.hasAttribute('popover')) as HTMLElement
  /** The words the place was last decided for, and whether it was the header's end. */
  let decidedFor: Element | null = null
  let atEnd = false
  const place = (decide: boolean): void => {
    const r = run.getBoundingClientRect()
    const words = line.querySelector('.notice-text')
    if (decide || words !== decidedFor) {
      decidedFor = words
      // EITHER PLACE LEAVES THE NOTICE AT LEAST THE RUN'S WIDTH, so its width as drawn now answers whether it fits.
      // **LESS THE GAP THE RUN GIVES BACK** (`style.css`'s `.bar-spacer`): its box starts at the control before it, and
      // a notice as wide as the box would sit flush against that control.
      atEnd = line.getBoundingClientRect().width > r.width + Number.parseFloat(getComputedStyle(run).marginInlineStart)
    }
    const headerEnd =
      header.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(header).paddingInlineEnd)
    const end = atEnd ? headerEnd : r.right
    const row = atEnd ? last.getBoundingClientRect() : r
    line.style.setProperty('--notice-end', `${document.documentElement.clientWidth - (end + scrollX)}px`)
    line.style.setProperty('--notice-row', `${row.top + row.height / 2 + scrollY}px`)
    // TAB REACHES THE ACTION WHERE IT IS DRAWN: after the run, before `share`, when it ends where the run does; after
    // `settings` when it ends that control's row. A move drops the focus, so a focused action takes it back.
    if (atEnd ? line.nextElementSibling !== null : line.previousElementSibling !== run) {
      const focused = line.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null
      if (atEnd) header.append(line)
      else run.after(line)
      focused?.focus()
    }
  }
  const resized = new ResizeObserver(() => place(true))
  resized.observe(header)
  for (const control of header.children) if (control !== line) resized.observe(control)
  new MutationObserver(() => place(false)).observe(line, {
    childList: true,
    subtree: true,
    characterData: true,
    attributeFilter: ['hidden'],
  })
}

export function createNotices(line: HTMLElement, live: HTMLElement, fallback?: () => HTMLElement | null): Notices {
  line.hidden = true
  live.setAttribute('role', 'status')
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastSaid = ''

  // A LIVE REGION ANNOUNCES A CHANGE, SO A REPEAT OF THE SAME WORDS WOULD BE SILENT. A trailing space
  // toggled on a repeat makes it a change without changing what is read.
  const say = (text: string): void => {
    const next = text === lastSaid.trimEnd() && !lastSaid.endsWith(' ') ? `${text} ` : text
    lastSaid = next
    live.textContent = next
  }

  /** What the line falls back to when nothing transient is up — `rest` sets it. */
  let resting: string | null = null
  /** Every resting sentence announced on this page load — see `rest` for why once is the rule. */
  const said = new Set<string>()

  /** The action on the line now, if any: its own `fallback` is where the focus goes when it goes. */
  let shown: NoticeAction | undefined

  /** Whether an action's press is being handled: what the line draws meanwhile catches the press's second click. */
  let pressing = false
  /** Ends the line's catching, `SECOND_CLICK_MS` after the last notice drawn while a press was handled. */
  let catching: ReturnType<typeof setTimeout> | null = null
  // A CAUGHT PRESS ON THE WORDS MOVES NO FOCUS AND SELECTS NOTHING: the action just put the focus where it belongs.
  line.addEventListener('mousedown', (e) => {
    if (!(e.target instanceof Element && e.target.closest('.notice-action'))) e.preventDefault()
  })

  /**
   * The resting sentence its `hide` took off the line. **IT STAYS OFF UNTIL THE CONDITION SAYS SOMETHING ELSE**: a
   * condition can last the whole session, and the line floats over the header, so the user may put it away; the same
   * sentence reported again, after a write that went through, is the condition they put away, and a different one is
   * news.
   */
  let hidden: string | null = null
  /** **NO FALLBACK OF ITS OWN**: hidden, the line is empty, and the focus goes to the line's. */
  const hide: NoticeAction = {
    label: 'hide',
    run: () => {
      hidden = resting
      paint(null)
    },
  }

  /**
   * Draw `text` as the line's whole contents, with an optional action, or empty it for `null`.
   *
   * **IT CAN BE HOLDING THE FOCUS, AND THEN IT OWES IT SOMEWHERE** — Plan 7 part 2 spec §11, and the
   * accessibility list's item 1. The line's actions are *undo*s — of a copy's delete, an imported
   * palette's removal, an example's pick and a link's open — each on a notice that lasts eight seconds; a
   * user who tabs to one and waits, or uses it, or is still on it when any other gesture makes a notice,
   * has the button taken out from under them by the very next repaint. The action's own `fallback` takes
   * the focus then, where it names one — the settings button a palette's removal was made from,
   * `examples ▾` for a pick, the share button for an open — and `fallback` otherwise: what the app hands
   * over, the control that lists the copies, which is where a copy's undo that did not happen leaves
   * the user.
   *
   * **THE SAME ACTION AGAIN KEEPS ITS BUTTON, AND ONLY THE WORDS CHANGE** — Plan 7 part 6a spec §5.5: a link's clamps
   * redraw the open's notice with the open's `undo`, hundreds of milliseconds after the open, while a user may be
   * pressing it. Chrome dispatches a `click` only where the press and the release land on the same element: a
   * button replaced while pressed clicks nothing even drawn in the same place, and one kept but moved from under the
   * pointer clicks no undo. So the button stays the same element, the focus stays on it, and the stylesheet keeps
   * it in place: at the notice's end, on its first line, whatever the words' length.
   */
  const paint = (text: string | null, action?: NoticeAction, toAction = true): void => {
    const words = line.querySelector<HTMLElement>('.notice-text')
    if (text !== null && action !== undefined && action === shown && words !== null) {
      words.textContent = text
      return
    }
    const held = line.contains(document.activeElement)
    const leaving = shown?.fallback ?? fallback
    shown = action
    if (text === null) {
      line.replaceChildren()
      line.hidden = true
      if (held) leaving?.()?.focus()
      return
    }
    const t = document.createElement('span')
    t.className = 'notice-text'
    t.textContent = text
    line.replaceChildren(t)
    if (action !== undefined) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'notice-action'
      b.textContent = action.label
      b.addEventListener('click', (e) => {
        // A DOUBLE-CLICK'S SECOND CLICK IS NOT A PRESS ON `hide`: the resting sentence comes back with its `hide` in
        // the place of the action the first click ran, and would go with the one sign that nothing is being saved.
        if (action === hide && e.detail > 1) return
        pressing = true
        try {
          dismiss()
          action.run()
        } finally {
          pressing = false
        }
      })
      line.append(b)
    }
    line.hidden = false
    if (pressing) {
      line.classList.add('notice-catching')
      if (catching !== null) clearTimeout(catching)
      catching = setTimeout(() => {
        catching = null
        line.classList.remove('notice-catching')
      }, SECOND_CLICK_MS)
    }
    // THE NEW LINE'S OWN ACTION IF IT HAS ONE, SO A KEYBOARD USER STAYS ON THE LINE THEY WERE ON — unless `toAction`
    // is false: the resting sentence's `hide` is not where a user who was on an undo meant to be.
    const own = toAction ? line.querySelector<HTMLElement>('button.notice-action') : null
    if (held) (own ?? leaving?.() ?? null)?.focus()
  }

  /**
   * The resting sentence with its `hide`, or an empty line while there is none or it is hidden. **A FOCUS THE LINE
   * HOLDS GOES TO THE ENDING ACTION'S FALLBACK, NOT TO `hide`**: an undo pressed, or left to expire, under the focus
   * hands it where that undo names (`main.ts`'s palette removal promises the settings button), and a second press of
   * Enter must not land on `hide`.
   */
  const paintResting = (): void => {
    if (resting === null || resting === hidden) paint(null)
    else paint(resting, hide, false)
  }

  /** The notice on the line now, until it ends: the one whose own `dismiss` still acts. */
  let current: Notice | null = null

  // THE TRANSIENT NOTICE ENDS AND THE RESTING ONE COMES BACK — silently: it is the same sentence the user
  // has already been told and already heard, so re-announcing it on every expiry would say it again and
  // again while nothing changed.
  const dismiss = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    current = null
    paintResting()
  }

  return {
    notify(text, opts = {}) {
      if (timer !== null) clearTimeout(timer)
      timer = null
      paint(text, opts.action)
      say(text)
      timer = setTimeout(dismiss, NOTICE_MS)
      const notice: Notice = {
        dismiss: () => {
          if (current === notice) dismiss()
        },
      }
      current = notice
      return notice
    },
    announce: say,
    dismiss,
    rest(text: string | null): void {
      if (text === resting) return
      resting = text
      if (text !== null && text !== hidden) hidden = null
      // **SAID ONCE A PAGE LOAD, NOT ONCE A CYCLE.** `resting` alone suppresses only a repeat while the
      // condition still holds — and it does not hold continuously: `localStorage` refuses a write by
      // SIZE, so a user typing into a copy near the quota gets a write every 300 ms, some succeeding and
      // some not. Each failure after a success would be a fresh announcement of a sentence the user has
      // already heard, which is the per-keystroke chatter §11's link rule exists to forbid. The line
      // still tracks the condition exactly; only the announcement is once.
      // **SAID AT ONCE, SHOWN WHEN THE LINE IS FREE.** A condition that has just begun is worth hearing
      // when it begins, so it goes to the live region whatever is on screen; the line itself is not
      // taken from under a notice the user may be reading, and `dismiss` paints this when that notice
      // ends. Without the split, a gesture that both fails to save AND says something of its own — a
      // copy created, which persists and then reports — would leave the condition unsaid for the eight
      // seconds its own notice holds the line.
      if (text !== null && !said.has(text)) {
        said.add(text)
        say(text)
      }
      if (timer === null) paintResting()
    },
  }
}
