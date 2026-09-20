import type { PaneChoice, SplitChoices } from './pane-chrome'
import { bindingKey, pairLabel } from './view-header'
import type { Preset } from './workspace'

/**
 * THE APP HEADER'S MENUS — Plan 7 part 2 spec §6: the workspace menu, `+ view` and settings. Each is a native
 * popover beside the button that opens it, declared in `index.html` so the pre-paint script and the skin
 * selects need no change; this module wires what markup cannot.
 */

/**
 * The popover wiring every header menu shares: the invoker relationship, `aria-expanded` kept true to the
 * popover's state, and an optional rebuild on open — the pattern the old split popovers established, which
 * `view-header.ts`'s `viewHeader` and `viewMenu` each kept.
 */
export function wireMenu(button: HTMLButtonElement, menu: HTMLElement, onOpen?: () => void): void {
  button.popoverTargetElement = menu
  menu.addEventListener('beforetoggle', (e) => {
    const open = e.newState === 'open'
    button.setAttribute('aria-expanded', String(open))
    if (!open) return
    onOpen?.()
    const first = menu.querySelector<HTMLElement>('button:not([disabled]), select')
    if (first !== null) first.autofocus = true
  })
}

/** The workspace menu's name for a preset — and `custom` when the switches match none (spec §4). */
export function presetName(p: Preset | null): string {
  if (p === null) return 'custom'
  return { explorer: 'Explorer', debugger: 'Debugger', stage: 'Stage' }[p]
}

/**
 * Fill `+ view`'s menu: every pair, then `source` while no view shows it — the split menu's list without its
 * first entry, because `+ view` has no "this view" to offer another view of.
 */
export function addViewItems(menu: HTMLElement, choices: SplitChoices, pick: (c: PaneChoice) => void): void {
  const items = choices.options.map((o) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = pairLabel(o)
    b.dataset.binding = bindingKey(o.leg, o.id)
    b.addEventListener('click', () => {
      menu.hidePopover()
      pick({ kind: o.leg, session: o.id })
    })
    return b
  })
  if (choices.sourceAvailable) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = 'source'
    b.dataset.source = ''
    b.addEventListener('click', () => {
      menu.hidePopover()
      pick({ kind: 'source' })
    })
    items.push(b)
  }
  menu.replaceChildren(...items)
}
