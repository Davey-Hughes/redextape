/**
 * THE NOTICE LINE AND THE LIVE REGION — Plan 7 part 2 spec §11.
 *
 * **ONE VISIBLE NOTICE AT A TIME, AND ONE POLITE LIVE REGION FOR THE WHOLE APP.** Every refusal, every copy
 * change and every layout change is said here, once, in words: shown on a line under the header, and written
 * to a visually hidden `role="status"` element so a screen reader hears it. Before this, refusals were a
 * clause on `#link-status`, which announced nothing (the accessibility list's items 6, 9, 10, 13 and 14 are
 * that silence, one control at a time).
 *
 * **A NEW NOTICE REPLACES THE OLD ONE, ACTION AND ALL.** A notice lasts `NOTICE_MS`, or until the next one;
 * an undo offered by a notice that has been replaced is gone with it (spec §10). A condition that LASTS is
 * not a notice at all — it is the line's resting state (`rest`), which every notice shows over and which
 * comes back when each one ends.
 *
 * **`announce` IS THE LIVE REGION ALONE**, for a sentence already on screen elsewhere: the readout's link
 * sentence, said when a link gesture changes it.
 */

/** How long a notice stays, in milliseconds (spec §10's "8 s"). */
export const NOTICE_MS = 8000

export type NoticeAction = { readonly label: string; readonly run: () => void }

export type Notices = {
  notify(text: string, opts?: { readonly action?: NoticeAction }): void
  announce(text: string): void
  /**
   * End the notice that is up now and put `rest` back under it.
   *
   * **ON THE SHAPE, BUT NOTHING OUTSIDE THIS MODULE CALLS IT — said here rather than left to be
   * discovered.** `createNotices` reaches its own `dismiss` twice: the `NOTICE_MS` timer, and an action
   * button, which must tear the notice down before running the action (a second undo would throw).
   * Neither of those needs the member. It is on the type so that "end this one early" has a name a
   * caller can find, instead of `rest(null)`, which clears the RESTING condition and is a different
   * thing entirely. No other module in `src/` and no test drives it — which is worth one line, so the
   * next reader does not go hunting for the caller.
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
   * `null` clears it, which is what a write that succeeds does.
   */
  rest(text: string | null): void
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

  /**
   * Draw `text` as the line's whole contents, with an optional action, or empty it for `null`.
   *
   * **IT CAN BE HOLDING THE FOCUS, AND THEN IT OWES IT SOMEWHERE** — spec §11, and the accessibility
   * list's item 1. The line's one action is *undo*, offered for eight seconds; a user who tabs to it and
   * waits, or who is still on it when any other gesture makes a notice, has the button taken out from
   * under them by the very next repaint. `fallback` is what the app hands over for that case — the
   * control that lists the copies, which is where an undo that did not happen leaves the user.
   */
  const paint = (text: string | null, action?: NoticeAction): void => {
    const held = line.contains(document.activeElement)
    if (text === null) {
      line.replaceChildren()
      line.hidden = true
      if (held) fallback?.()?.focus()
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
      b.addEventListener('click', () => {
        dismiss()
        action.run()
      })
      line.append(b)
    }
    line.hidden = false
    // THE NEW LINE'S OWN ACTION IF IT HAS ONE, SO A KEYBOARD USER STAYS ON THE LINE THEY WERE ON.
    if (held) (line.querySelector<HTMLElement>('button.notice-action') ?? fallback?.() ?? null)?.focus()
  }

  // THE TRANSIENT NOTICE ENDS AND THE RESTING ONE COMES BACK — silently: it is the same sentence the user
  // has already been told and already heard, so re-announcing it on every expiry would say it again and
  // again while nothing changed.
  const dismiss = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    paint(resting)
  }

  return {
    notify(text, opts = {}) {
      if (timer !== null) clearTimeout(timer)
      timer = null
      paint(text, opts.action)
      say(text)
      timer = setTimeout(dismiss, NOTICE_MS)
    },
    announce: say,
    dismiss,
    rest(text: string | null): void {
      if (text === resting) return
      resting = text
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
      if (timer === null) paint(resting)
    },
  }
}
