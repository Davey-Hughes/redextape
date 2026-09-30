import { readScheme, type SchemeVariant, schemeName } from './base16'
import {
  adjustLine,
  checkScheme,
  failureLines,
  type MovedColour,
  movedColours,
  movedLine,
  passes,
  type SchemeCheck,
  summaryLines,
} from './base16-check'
import type { CustomHalf, CustomPalette } from './custom-palette'
import { createPanel } from './panel'

/**
 * THE BASE16 IMPORT DIALOG (Plan 7 part 6b spec §8): a native modal `<dialog>` the settings menu's `import base16…`
 * opens. A scheme is pasted, checked — its name, its variant and how it measures against the floors the built-ins
 * meet — and applied as it is or adjusted, into the half of the `custom` palette its variant names.
 *
 * **MODAL, SO EVERYTHING OUTSIDE IT IS INERT WHILE IT IS OPEN**, the header's menus and the notice line included —
 * and the app's one live region, `#live`, with them. So the dialog has a polite live region of its own, which says
 * each check's summary line, or what could not be read, when `check` finishes.
 *
 * **EVERY CLOSE GIVES THE FOCUS TO `#settings`, AND A `close` HANDLER DOES IT, NOT THE PLATFORM.** The item that
 * opens the dialog sits in the settings popover, which `main.ts` hides first. Hiding a popover that holds the focus
 * hands it back to the element that held it before the popover opened — not to its invoker — and closing a modal
 * dialog hands it back to the element that held it before `showModal`. In Chromium a click focuses `#settings`, so
 * the two coincide there; in WebKit, and in Firefox on macOS, a mouse click does not focus a button, and both would
 * leave the focus wherever it was before the menu opened. The item itself would strand it in a closed popover.
 *
 * **A CONTROL THAT CANNOT ACT SAYS WHY** (umbrella §4 rule 4), as *edit a copy* does: the reason as its
 * `aria-description` and in a visible line under the actions.
 */

export type Base16DialogDeps = {
  /** The settings button, which every close gives the focus to. */
  readonly settings: HTMLElement
  /** The imported palette as stored now, for the `now` line, or `null` for none. */
  readonly stored: () => CustomPalette | null
  /** The half the page shows now: `light` or `dark`, whatever the appearance setting resolves to. */
  readonly shown: () => SchemeVariant
  /** Store `half` as `variant`'s half of the `custom` palette, choose `custom`, and apply it. */
  readonly apply: (variant: SchemeVariant, half: CustomHalf) => void
  /** Delete `variant`'s stored half, and offer to undo it. */
  readonly remove: (variant: SchemeVariant) => void
}

export type Base16Dialog = {
  readonly el: HTMLDialogElement
  /** Open it, modal, with what is stored now, an empty scheme and nothing checked. */
  open(): void
}

const CHECK_FIRST = 'check the scheme first'
const UNREADABLE = 'the scheme could not be read'
const NOTHING_TO_ADJUST = 'nothing to adjust — every check passes'
const NOTHING_FIXES = 'nothing to adjust — no lightness fixes what fails'

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  el.className = className
  el.textContent = text
  return el
}

function button(className: string, text: string): HTMLButtonElement {
  const b = element('button', className, text)
  b.type = 'button'
  return b
}

/** A swatch of `hex`, drawn from the data the way `skin.ts`'s `applySkin` sets a token, and hidden: the hex text says it. */
function swatch(hex: string): HTMLElement {
  const s = element('span', 'base16-swatch')
  s.setAttribute('aria-hidden', 'true')
  s.style.backgroundColor = hex
  return s
}

/** One changed colour as a list item: a swatch of each value, then `base08 #bf616a → #f59199, as error text`. */
function changeItem(m: MovedColour): HTMLLIElement {
  const li = element('li', 'base16-change')
  li.append(swatch(m.from), swatch(m.to), document.createTextNode(movedLine(m)))
  return li
}

export function createBase16Dialog(deps: Base16DialogDeps): Base16Dialog {
  const dialog = element('dialog', 'base16-dialog')
  const heading = element('h2', 'base16-heading', 'import a base16 scheme')
  heading.id = 'base16-heading'
  dialog.setAttribute('aria-labelledby', heading.id)

  const field = element('label', 'base16-field', 'base16 scheme (YAML)')
  const text = element('textarea', 'base16-text')
  text.spellcheck = false
  text.rows = 12
  field.append(text)

  const now = element('div', 'base16-now')
  const check = button('base16-check', 'check')
  const result = element('div', 'base16-result')
  const apply = button('base16-apply', 'apply')
  const adjusted = button('base16-apply-adjusted', 'apply adjusted')
  const cancel = button('base16-cancel', 'cancel')
  const actions = element('div', 'base16-actions')
  actions.append(apply, adjusted, cancel)
  const why = element('p', 'base16-why')
  const status = element('p', 'base16-status visually-hidden')
  status.setAttribute('role', 'status')
  dialog.append(heading, now, field, check, result, status, actions, why)

  /** Say `text` in the dialog's live region — a repeat with a trailing space, as `notice.ts` says one, or it is silent. */
  const say = (text: string): void => {
    status.textContent = status.textContent === text ? `${text} ` : text
  }

  /** The check the applies act on: `null` before one, after an edit, and when the text did not read. */
  let checked: SchemeCheck | null = null

  const able = (b: HTMLButtonElement, reason: string | null): void => {
    b.disabled = reason !== null
    if (reason === null) b.removeAttribute('aria-description')
    else b.setAttribute('aria-description', reason)
  }
  /** Each apply's reason, or `null` where it can act; the visible line says each reason once. */
  const allow = (plain: string | null, adjust: string | null): void => {
    able(apply, plain)
    able(adjusted, adjust)
    const reasons = [...new Set([plain, adjust].filter((r) => r !== null))]
    why.textContent = reasons.join(' · ')
    why.hidden = reasons.length === 0
  }

  const reset = (): void => {
    checked = null
    result.replaceChildren()
    status.textContent = ''
    allow(CHECK_FIRST, CHECK_FIRST)
  }

  const show = (): void => {
    const reading = readScheme(text.value)
    if (!reading.ok) {
      checked = null
      const errors = element('ul', 'base16-errors')
      errors.append(...reading.errors.map((e) => element('li', '', e)))
      result.replaceChildren(errors)
      say(reading.errors.join('; '))
      allow(UNREADABLE, UNREADABLE)
      return
    }
    const c = checkScheme(reading.scheme)
    checked = c
    const summary = summaryLines(c)
    say(summary[0] ?? '')
    const lines = summary.map((l) => element('p', 'base16-summary', l))
    const adjusting = adjustLine(c)
    if (adjusting !== null) lines.push(element('p', 'base16-adjusts', adjusting))
    // THE HALF NOT ON SCREEN STILL CHOOSES `custom`, SO THE PAGE CHANGES, AND THIS SAYS TO WHAT: the half on screen is
    // then the one stored for it, or, with none, the style's own (umbrella §7), whatever palette was chosen before.
    const shown = deps.shown()
    const { variant } = reading.scheme
    if (variant !== shown) {
      const onScreen = deps.stored()?.[shown]
      const then =
        onScreen === undefined
          ? `its palette is the style’s own until you import a ${shown} scheme`
          : `its palette is the ${shown} import, ${schemeName(onScreen.name)}, until the appearance is ${variant}`
      lines.push(element('p', 'base16-elsewhere', `fills the ${variant} palette; the page is ${shown} now, so ${then}`))
    }
    result.replaceChildren(...lines)
    const moved = movedColours(c.scheme.colours, c.adjustment.tokens)
    if (!passes(c)) {
      const body = element('div', 'base16-details-body')
      const failures = element('ul', 'base16-failures')
      failures.append(...failureLines(c).map((l) => element('li', '', l)))
      const changes = element('ul', 'base16-changes')
      changes.append(...moved.map(changeItem))
      body.append(failures, element('p', 'base16-changes-label', 'changes'), changes)
      result.append(createPanel({ name: 'base16-details', label: 'details', body, open: false }).el)
    }
    // A FAILING SCHEME THE ADJUSTMENT MOVES NO COLOUR OF: `apply adjusted` would store what `apply` stores, marked
    // adjusted, with a `changes` panel that lists nothing — every colour that fails is one no lightness fixes.
    allow(null, passes(c) ? NOTHING_TO_ADJUST : moved.length === 0 ? NOTHING_FIXES : null)
  }

  /**
   * **NOW**, when a half is stored (spec §8.2): each half's name, a `remove` beside it, and a `changes` panel for
   * the colours an adjusted half moved, read off its stored colours and tokens. A remove closes the dialog: its
   * *undo* is on the notice line, outside the modal and inert while it is open.
   */
  const showStored = (): void => {
    const stored = deps.stored()
    now.hidden = stored === null
    if (stored === null) {
      now.replaceChildren()
      return
    }
    const line = element('p', 'base16-now-line', 'now: ')
    const changes = element('div', 'base16-now-changes')
    for (const variant of ['light', 'dark'] as const) {
      const half = stored[variant]
      if (half === undefined) continue
      if (line.childNodes.length > 1) line.append(' · ')
      const name = schemeName(half.name)
      line.append(`${variant} — ${name}${half.adjusted ? ', adjusted' : ''} `)
      // THE LABEL ALONE DOES NOT SAY WHICH HALF IT ACTS ON, SO THE NAME DOES, AND THE TOOLTIP CARRIES IT: the controls
      // gate holds a name to the visible label or the tooltip.
      const remove = button('base16-remove', 'remove')
      remove.title = `remove the ${variant} palette, ${name}`
      remove.setAttribute('aria-label', remove.title)
      remove.addEventListener('click', () => {
        dialog.close()
        deps.remove(variant)
      })
      line.append(remove)
      if (half.adjusted) {
        const list = element('ul', 'base16-changes')
        list.append(...movedColours(half.colours, half.tokens).map(changeItem))
        // THE HALF IS A LABEL, IN THE STYLE'S CASE; THE NAME IS THE SCHEME'S, AND KEEPS ITS OWN.
        const label = element('p', 'base16-changes-label', `${variant} — `)
        label.append(element('span', 'base16-scheme-name', name))
        changes.append(label, list)
      }
    }
    now.replaceChildren(line)
    if (changes.childNodes.length > 0) {
      now.append(createPanel({ name: 'base16-now-changes', label: 'changes', body: changes, open: false }).el)
    }
  }

  // CLOSED BEFORE THE APPLY, AS A REMOVE IS: a refused write's notice goes to `#live`, which the modal makes inert.
  const commit = (adjust: boolean): void => {
    if (checked === null) return
    const { scheme, tokens, adjustment } = checked
    dialog.close()
    deps.apply(scheme.variant, {
      name: scheme.name,
      colours: scheme.colours,
      tokens: adjust ? adjustment.tokens : tokens,
      adjusted: adjust,
    })
  }

  check.addEventListener('click', show)
  text.addEventListener('input', reset)
  apply.addEventListener('click', () => commit(false))
  adjusted.addEventListener('click', () => commit(true))
  cancel.addEventListener('click', () => dialog.close())
  // `close` FOLLOWS EVERY CLOSE — `cancel`, `Esc`, an apply, a remove — after the platform has put the focus back.
  dialog.addEventListener('close', () => deps.settings.focus())
  reset()

  return {
    el: dialog,
    open() {
      showStored()
      text.value = ''
      reset()
      dialog.showModal()
      text.focus()
    },
  }
}
