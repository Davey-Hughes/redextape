import type { PaneChoice, SplitChoices } from './pane-chrome'
import { bindingKey, pairLabel } from './view-header'
import { PRESETS, type Preset, presetOf, type Switches } from './workspace'

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

/** One switch in the workspace menu: what it is called, and the words its two values go by (spec §4). */
export type SwitchRow = {
  readonly key: keyof Switches
  readonly label: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
}

/**
 * The three switches, in spec §4's table order, with §4's words.
 *
 * **THE TABLE IS THE ORDER AND THE WORDING, AND IT IS DATA RATHER THAN THREE HAND-BUILT SECTIONS.** A
 * switch is a two-way choice whose values already have names the spec fixed; writing each one out would be
 * three copies of one shape, and the copy is where a fourth switch would be forgotten.
 *
 * **`value` IS `string` AND NOT `Switches[K]`.** A `SwitchRow` is a row of a table, and a table typed
 * per-row needs a discriminated union of three row types to carry three value unions — for a list whose
 * only consumer immediately writes the value back through `parseSwitches`, which re-narrows it. The
 * narrowing that matters is at the write, and `main.ts`'s menu wiring has it.
 */
export const SWITCH_ROWS: readonly SwitchRow[] = [
  {
    key: 'steps',
    label: 'step controls',
    options: [
      { value: 'view', label: 'in each view' },
      { value: 'bar', label: 'one bar' },
    ],
  },
  {
    key: 'views',
    label: 'views',
    options: [
      { value: 'tiles', label: 'tiles' },
      { value: 'stage', label: 'stage' },
    ],
  },
  {
    key: 'readout',
    label: 'readout',
    options: [
      { value: 'strip', label: 'strip' },
      { value: 'inspector', label: 'inspector' },
    ],
  },
]

/**
 * Fill the workspace menu: the three presets as one choice, the three switches as three two-way choices with
 * the value in force marked, then *reset preset* — which is not there while the workspace is custom (spec §4,
 * §6).
 *
 * **IT IS CALLED ON OPEN AND AGAIN ON EVERY PICK, WITH THE MENU STILL OPEN.** A pick changes which value is
 * marked and may add or remove *reset preset*, so the menu has to repaint under the user's hand — which
 * destroys the button they just clicked.
 *
 * **SO THE FOCUS IS PUT BACK BY IDENTITY, NOT BY ELEMENT.** `data-preset` and `data-switch`+`data-value` are
 * a durable name for a button across a rebuild, exactly as `layout-view.ts`'s divider rescue uses
 * `data-path`/`data-index` across `replaceChildren`.
 *
 * **WHEN THE IDENTITY IS GONE, THE FIRST ITEM TAKES IT** — spec §11's fourth rule, reached here by *reset
 * preset* being removed by a pick that made the workspace custom. `focus-handoff.ts`'s `nearest` is NOT what
 * answers it: this rebuild replaces every item, so there is no "remaining control" near the departing one to
 * walk to — every candidate `nearest` could name was detached by the same `replaceChildren`. The first item
 * of the rebuilt menu is the honest answer, and it is the one `wireMenu` already autofocuses on open.
 *
 * **`reset` IS THE CALLER'S OWN ELEMENT, NOT ONE BUILT HERE**, for `bufferList`'s reason: `main.ts` holds
 * `#reset-preset` from the markup and wired its click handler once. Rebuilding it per open would need the
 * handler rewired per open, and a menu item that is sometimes a different element is a second thing for a
 * test to select.
 */
export function workspaceItems(
  menu: HTMLElement,
  state: { readonly switches: Switches; readonly reset: HTMLButtonElement },
  on: {
    preset(p: Preset): void
    flip(key: keyof Switches, value: string): void
  },
): void {
  const held = document.activeElement
  const identity =
    held instanceof HTMLElement && menu.contains(held)
      ? { preset: held.dataset.preset, key: held.dataset.switch, value: held.dataset.value, id: held.id }
      : null

  const button = (label: string, name: string, mark: boolean, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    // THE NAME SAYS WHICH CHOICE THIS IS, AND THE TOOLTIP CARRIES IT TOO. `controls-gate.test.ts` holds a
    // control's accessible name equal to its visible label or its tooltip; `one bar` on its own is a
    // visible label that does not say what it is one bar OF, so the name is the longer sentence and the
    // tooltip is what makes the two agree.
    b.title = name
    b.setAttribute('aria-label', name)
    if (mark) b.setAttribute('aria-current', 'true')
    b.addEventListener('click', run)
    return b
  }

  const group = (label: string, items: readonly HTMLElement[]): HTMLElement => {
    const g = document.createElement('div')
    g.className = 'menu-group'
    g.setAttribute('role', 'group')
    g.setAttribute('aria-label', label)
    g.append(...items)
    return g
  }

  const now = presetOf(state.switches)
  const presets = group(
    'preset',
    (Object.keys(PRESETS) as Preset[]).map((p) => {
      const b = button(presetName(p), `preset — ${presetName(p)}`, p === now, () => on.preset(p))
      b.dataset.preset = p
      return b
    }),
  )

  const switches = SWITCH_ROWS.map((row) =>
    group(
      row.label,
      row.options.map((o) => {
        const b = button(o.label, `${row.label} — ${o.label}`, state.switches[row.key] === o.value, () =>
          on.flip(row.key, o.value),
        )
        b.dataset.switch = row.key
        b.dataset.value = o.value
        return b
      }),
    ),
  )

  menu.replaceChildren(presets, ...switches)
  // **REMOVED, NOT DISABLED, WHILE THE WORKSPACE IS CUSTOM** (umbrella §4 rule 4): there is no preset for
  // it to restore, so it can never apply in this state — choosing a preset is the way back.
  if (now !== null) menu.append(state.reset)

  if (identity === null) return
  const back =
    identity.preset !== undefined
      ? menu.querySelector<HTMLElement>(`[data-preset="${identity.preset}"]`)
      : identity.key !== undefined
        ? menu.querySelector<HTMLElement>(`[data-switch="${identity.key}"][data-value="${identity.value}"]`)
        : identity.id === ''
          ? null
          : menu.querySelector<HTMLElement>(`#${identity.id}`)
  if (back !== null) back.focus()
  else menu.querySelector<HTMLElement>('button:not([disabled])')?.focus()
}
