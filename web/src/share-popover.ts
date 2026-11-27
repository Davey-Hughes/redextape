import { n } from './format'
import { encodeLink, type SharePayload } from './share-link'

/**
 * THE SHARE POPOVER — Plan 7 part 6a spec §5.2: `share`'s popover, built again on each open as the workspace menu is,
 * so nothing keeps a link current (row 8). It holds the link in a read-only field, which takes the focus with its text
 * selected; `copy link`, where the page can write to the clipboard; and under them, describing the field and said in
 * the live region, a line saying how long the link is, past the length some apps cut.
 */

/** The length past which a link is said to be long: many chat and mail clients cut a link past it (spec row 8). */
export const LONG_LINK = 2000

/** What the popover asks of the page each time it opens. */
export type ShareDeps = {
  /** The popover, `#share-menu`. */
  readonly menu: HTMLElement
  /** What the link carries: the program, its encoding, the workspace and positions (spec §5.1). */
  readonly payload: () => SharePayload
  /** What the fragment follows: `location.origin + location.pathname`. */
  readonly base: () => string
  /**
   * The clipboard, or `undefined` where the page is not a secure context and there is none. **ASKED ON EACH OPEN**,
   * as everything the popover holds is, so the page is asked when the popover is built and no answer is kept.
   */
  readonly clipboard: () => Pick<Clipboard, 'writeText'> | undefined
  readonly notify: (text: string) => void
  /** Say `text` in the live region alone, for a sentence the popover already shows (`notice.ts`'s `announce`). */
  readonly announce: (text: string) => void
}

/** The line saying a link is long, or `null` for one no longer than `LONG_LINK` (spec §5.2, row 8). */
export function lengthLine(link: string): string | null {
  if (link.length <= LONG_LINK) return null
  return `this link is ${n(link.length)} characters long — some chat and mail apps cut links past ${n(LONG_LINK)}`
}

/**
 * Wire the popover's content, answering what `wireMenu` runs on each open.
 *
 * **THE FIELD IS `autofocus`, AND ITS TEXT IS SELECTED WHEN THE LINK ARRIVES.** `wireMenu` autofocuses a link, a button
 * or a select, and `copy link` is disabled while the link is made, so the field is marked here, and the popover's showing
 * puts the focus in it. The link is made asynchronously, since `CompressionStream` is, so it always arrives after the
 * popover has shown: selecting it on `toggle`, where the spec put it, would select an empty field. It is selected as it
 * is filled instead, while the field still holds the focus.
 *
 * **A LINK THAT ARRIVES AFTER THE POPOVER WAS OPENED AGAIN FILLS ITS OWN OPEN'S FIELD**, which that open's rebuild took
 * off the page, and so changes nothing a user can see.
 */
export function createShare(deps: ShareDeps): () => void {
  const { menu } = deps
  return () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.readOnly = true
    input.id = 'share-link'
    input.autofocus = true
    input.spellcheck = false
    const label = document.createElement('label')
    label.className = 'share-field'
    label.append('link ', input)

    const clipboard = deps.clipboard()
    // **REMOVED WHERE IT CAN NEVER APPLY** (umbrella §4 rule 4): outside a secure context there is no clipboard, and
    // the selected field is the way to copy.
    const copy = clipboard === undefined ? null : document.createElement('button')
    if (copy !== null && clipboard !== undefined) {
      copy.type = 'button'
      copy.className = 'share-copy'
      copy.textContent = 'copy link'
      copy.disabled = true
      copy.title = 'the link is being made'
      copy.addEventListener('click', () => {
        clipboard.writeText(input.value).then(
          () => deps.notify('link copied'),
          () => {
            input.focus()
            input.select()
            deps.notify('the link could not be copied — it is selected in the field')
          },
        )
      })
    }

    const line = (id: string, text: string | null): HTMLElement | null => {
      if (text === null) return null
      const p = document.createElement('p')
      p.className = 'share-line'
      p.id = id
      p.textContent = text
      return p
    }
    menu.replaceChildren(label, ...(copy === null ? [] : [copy]))

    const payload = deps.payload()
    const base = deps.base()
    void encodeLink(payload).then((fragment) => {
      input.value = `${base}${fragment}`
      const long = line('share-length', lengthLine(input.value))
      if (long !== null) {
        const above = copy ?? label
        above.after(long)
        input.setAttribute('aria-describedby', long.id)
        // **SAID AS WELL AS DESCRIBED, BECAUSE THE DESCRIPTION COMES AFTER THE FOCUS.** The field took the focus when
        // the popover showed, before the link was made, and a screen reader reads a field's description as the focus
        // lands, not when it changes later. Only while this open's field is on show: a link that arrives after the
        // popover closed, or was opened again, says nothing about a link on screen.
        if (input.isConnected && menu.matches(':popover-open')) deps.announce(long.textContent ?? '')
      }
      if (copy !== null) {
        copy.disabled = false
        copy.removeAttribute('title')
      }
      if (document.activeElement === input) input.select()
    })
  }
}
