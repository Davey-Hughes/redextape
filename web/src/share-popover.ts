import { n } from './format'
import { encodeLink, type SharePayload } from './share-link'

/**
 * THE SHARE POPOVER — Plan 7 part 6a spec §5.2: `share`'s popover, built again on each open as the workspace menu is,
 * so nothing keeps a link current (row 8). It holds the link in a read-only field, which takes the focus with its text
 * selected; `copy link`, where the page can write to the clipboard; and up to two lines under them, each describing
 * the field: how long the link is, past the length some apps cut, and which views will open on the program because a
 * copy is not included.
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
  /** The title of each view showing a copy: the views a link opens on the program instead (spec row 14). */
  readonly copies: () => readonly string[]
  /**
   * The clipboard, or `undefined` where the page is not a secure context and there is none. **ASKED ON EACH OPEN**,
   * as everything the popover holds is, so the page is asked when the popover is built and no answer is kept.
   */
  readonly clipboard: () => Pick<Clipboard, 'writeText'> | undefined
  readonly notify: (text: string) => void
}

/** `a`, `a and b`, `a, b and c`. */
const listed = (names: readonly string[]): string =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * The line naming the views a link opens on the program, or `null` when no view shows a copy (spec §5.2, row 14).
 * `titles` holds one title for each VIEW, so two views of one copy arrive as the same title twice. Views are grouped by
 * copy, in the order each copy is first seen: one view reads `the X view`, two `both X views` and N more `all N X views`.
 * Where every copy has one view the line reads as `a`, `a and b`, `a, b and c` followed by `view` or `views`.
 */
export function copiesLine(titles: readonly string[]): string | null {
  if (titles.length === 0) return null
  const counts = new Map<string, number>()
  for (const title of titles) counts.set(title, (counts.get(title) ?? 0) + 1)
  if (counts.size === titles.length) {
    return `copies are not included — the ${listed(titles)} ${titles.length === 1 ? 'view' : 'views'} will open on the program`
  }
  const phrases = [...counts].map(([title, views]) =>
    views === 1 ? `the ${title} view` : views === 2 ? `both ${title} views` : `all ${views} ${title} views`,
  )
  return `copies are not included — ${listed(phrases)} will open on the program`
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
    const copies = line('share-copies', copiesLine(deps.copies()))
    const describe = (lines: readonly (HTMLElement | null)[]): void => {
      const ids = lines.flatMap((l) => (l === null ? [] : [l.id]))
      if (ids.length === 0) input.removeAttribute('aria-describedby')
      else input.setAttribute('aria-describedby', ids.join(' '))
    }
    describe([copies])
    menu.replaceChildren(label, ...(copy === null ? [] : [copy]), ...(copies === null ? [] : [copies]))

    const payload = deps.payload()
    const base = deps.base()
    void encodeLink(payload).then((fragment) => {
      input.value = `${base}${fragment}`
      const long = line('share-length', lengthLine(input.value))
      if (long !== null) (copy ?? label).after(long)
      describe([long, copies])
      if (copy !== null) {
        copy.disabled = false
        copy.removeAttribute('title')
      }
      if (document.activeElement === input) input.select()
    })
  }
}
