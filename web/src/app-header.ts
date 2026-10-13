import type { Example } from './examples'
import { HEADER_ORDER, KIND_WORD } from './layout'
import type { PaneChoice, SplitChoices } from './pane-chrome'
import type { PaneKind } from './panes'
import { bindingKey, pairLabel } from './view-header'
import { PRESETS, type Preset, presetOf, type Switches } from './workspace'

/**
 * THE APP HEADER'S MENUS — Plan 7 part 2 spec §6: the workspace menu, `+ view` and settings, `examples ▾` since
 * part 6a, and `about ▾` since the about pages. Each is a native popover beside the button that opens it, declared in
 * `index.html` so the pre-paint script and the skin selects need no change; this module wires what markup cannot.
 * The `views` toggles (the view layouts spec §6) are the header's one group that is not a menu.
 */

/**
 * The popover wiring every header menu shares, and `share`'s popover too, which is a disclosure and not a menu (Plan 7
 * part 6a spec §6): the invoker relationship, `aria-expanded` kept true to the popover's state, and an optional
 * rebuild on open — the pattern the old split popovers established, which `view-header.ts`'s `viewHeader` and
 * `viewMenu` each kept.
 */
export function wireMenu(button: HTMLButtonElement, menu: HTMLElement, onOpen?: () => void): void {
  button.popoverTargetElement = menu
  menu.addEventListener('beforetoggle', (e) => {
    const open = e.newState === 'open'
    button.setAttribute('aria-expanded', String(open))
    if (!open) return
    onOpen?.()
    const first = menu.querySelector<HTMLElement>('a[href], button:not([disabled]), select')
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

/**
 * Fill `examples ▾`'s menu: one item per example, in the manifest's order, each its title over its one-line description
 * (Plan 7 part 6a spec §4.2). Picking one closes the menu before `pick` runs, as every header menu's item does.
 *
 * **NAMED BY `aria-label`, AS THE VIEW MENU'S TWO-LINE ITEMS ARE** (`view-header.ts`'s `item`): built from the content,
 * the name would join the two spans with a space only while they are not `display: inline`, which is a rule about the
 * stylesheet rather than about the item.
 */
export function exampleItems(menu: HTMLElement, examples: readonly Example[], pick: (e: Example) => void): void {
  menu.replaceChildren(
    ...examples.map((example) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'example'
      b.dataset.example = example.id
      b.setAttribute('aria-label', `${example.title} ${example.description}`)
      const title = document.createElement('span')
      title.className = 'example-title'
      title.textContent = example.title
      const description = document.createElement('span')
      description.className = 'example-description'
      description.textContent = example.description
      b.append(title, description)
      b.addEventListener('click', () => {
        menu.hidePopover()
        pick(example)
      })
      return b
    }),
  )
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

/**
 * The window too narrow for the `views` toggles, as the media query that says so: 40rem wide or narrower, which is
 * 640 px at a browser's default text size (the view layouts spec §6.1).
 *
 * **THREE PLACES SAY THIS WIDTH, AND NONE CAN READ ANOTHER.** `main.ts` sets the group's `hidden` attribute from this
 * query. `style.css` has a media rule of the same width, for the paint before `main.ts` runs, and a stylesheet
 * imports nothing. `help.html` tells a reader the width in pixels. `tests/node/app-header.test.ts` reads the rule
 * and the page and holds each to this, and `tests/browser/view-toggles-narrow.test.ts` holds the attribute and the
 * rule to the same last pixel. With the rule at 30rem, or the query at 38rem, every test passed before those two.
 */
export const NARROW_WINDOW_REM = 40
export const NARROW_WINDOW = `(max-width: ${NARROW_WINDOW_REM}rem)`

/**
 * The header's `views` toggles — the view layouts spec §6: one button a kind, in `HEADER_ORDER`, pressed where the tree
 * on screen holds a view of that kind. `pick` is handed the kind a press asks to add or remove; `sync` is called with
 * the kinds on screen whenever they may have changed.
 *
 * **THE FOUR BUTTONS ARE THE PAGE'S OWN MARKUP, AND THIS ADOPTS THEM.** They were built here, which is after the
 * wasm has loaded, so they arrived in a header already painted. Measured at 1280 px in each style (2026-10-12): `+
 * view`, `copies`, `examples` and `encoding` each moved right by the group's width, 147.5 px in Paper, 149.1 in
 * Terminal and 154.0 in Instrument, and in Terminal the header went from one row to two, 46 px to 91. In `index.html`
 * they hold their place from the first paint, as not pressed, which is true of a page with no view built yet.
 * `tests/node/harness.test.ts` holds that markup to `HEADER_ORDER` and `KIND_WORD`, so the page cannot spell a kind
 * another way than the tables do.
 *
 * **THE NAME IS THE LABEL, AND THE TOOLTIP SAYS WHAT A PRESS DOES** (umbrella §4 rule 1). `source`, `λ`, `asm` and
 * `TM` are words a reader says, so each button is named by its own text, in a group named `views`, and `aria-pressed`
 * carries its state. The tooltip is the sentence, which is `toggleSentence`'s: *hide the TM view*, *show the TM view*,
 * and with `count` saying two views of the kind, *hide the 2 TM views*.
 *
 * **THE LAST PRESSED BUTTON IS DISABLED, AND ITS TOOLTIP IS THE REASON** (rule 4): it could apply and cannot now,
 * since one view stays, or one kind of view where it stands for several (`toggleSentence`). `aria-description` says
 * the same to a reader who does not hover, as *edit a copy* says its own reason.
 *
 * **`sync` IS HANDED HOW MANY VIEWS EACH TOGGLE STANDS FOR**, since the kinds on screen do not say: `count(kind)` is
 * the views of the kind a press would hide, or would show (`main.ts`'s `viewsOfKind`).
 *
 * **DISABLED BY `aria-disabled`, AND NOT BY THE `disabled` ATTRIBUTE, SO IT KEEPS THE FOCUS IT HAS.** A view key hides
 * views while the focus is on a toggle, and the toggle left pressed alone is that one or another. Measured with the
 * attribute (2026-10-12): the λ toggle focused, then the keys that hide the source, asm and TM views, and
 * `document.activeElement` was `<body>` as the third key returned. A button that says it is disabled this way still
 * takes a press, so `pick` is handed the press like any other and answers it: `main.ts` says the tooltip's words on
 * the notice line, as it does for the toggle key.
 *
 * **UPDATED IN PLACE**: a press must not cost the button its focus, and a rebuild would.
 */
export function viewToggles(
  group: HTMLElement,
  pick: (kind: PaneKind) => void,
): { sync(shown: readonly PaneKind[], count: (kind: PaneKind) => number): void } {
  const buttons = HEADER_ORDER.map((kind) => {
    // `data-shows`, NOT `data-kind`: that one is a view host's (`pane-host.ts`), and `[data-kind="lambda"]` is how the
    // page's λ views are counted.
    const b = group.querySelector<HTMLButtonElement>(`button.view-toggle[data-shows="${kind}"]`)
    if (b === null) throw new Error(`the page has no views toggle for ${kind}`)
    b.addEventListener('click', () => pick(kind))
    return b
  })
  return {
    sync(shown: readonly PaneKind[], count: (kind: PaneKind) => number): void {
      for (const b of buttons) {
        const kind = b.dataset.shows as PaneKind
        const pressed = shown.includes(kind)
        const only = pressed && shown.length === 1
        b.setAttribute('aria-pressed', String(pressed))
        if (only) b.setAttribute('aria-disabled', 'true')
        else b.removeAttribute('aria-disabled')
        const says = toggleSentence(kind, count(kind), only ? 'only' : pressed ? 'shown' : 'hidden')
        if (b.title !== says) b.title = says
        if (only) b.setAttribute('aria-description', says)
        else b.removeAttribute('aria-description')
      }
    },
  }
}

/**
 * What a `views` toggle says of the `count` views of `kind` it stands for — the view layouts spec §6: what a press
 * does where the kind is `shown` or `hidden`, and where it is the `only` kind shown, why a press does nothing.
 *
 * | `count` | `shown` | `hidden` | `only` |
 * | --- | --- | --- | --- |
 * | 1 | hide the TM view | show the TM view | the TM view is the only one shown — one view stays |
 * | 2 | hide the 2 TM views | show the 2 TM views | the 2 TM views are the only ones shown — one kind of view stays |
 *
 * **A TOGGLE ACTS ON EVERY VIEW OF ITS KIND, SO ITS SENTENCE COUNTS THEM.** Written for one view, it said *hide the
 * TM view* of a press that hid two, and *the TM view is the only one shown* with two TM views on screen and no other:
 * a first load, `+ view` and *TM · program*, then the source view's `✕` (measured 2026-10-12). **AND WHAT STAYS IS
 * ONE VIEW OF ONE, AND ONE KIND OF VIEW OF SEVERAL** (decided 2026-10-12): the several kept the one's reason
 * at first, *one view stays*, of two views that both stay.
 *
 * **THE ONE PLACE THE SENTENCE IS BUILT.** The tooltip (`viewToggles`) and the notice line's answer to a refused press
 * or key (`main.ts`'s `toggleView`) are the same words, and were two template strings.
 */
export function toggleSentence(kind: PaneKind, count: number, state: 'shown' | 'hidden' | 'only'): string {
  const several = count > 1
  const views = several ? `the ${count} ${KIND_WORD[kind]} views` : `the ${KIND_WORD[kind]} view`
  if (state === 'only')
    return several
      ? `${views} are the only ones shown — one kind of view stays`
      : `${views} is the only one shown — one view stays`
  return `${state === 'shown' ? 'hide' : 'show'} ${views}`
}

/**
 * The kinds on screen as a sentence for the live region, in the header's order whatever order they are handed in:
 * `showing source and TM`, `showing source, asm, λ and TM`.
 */
export function shownSentence(shown: readonly PaneKind[]): string {
  const words = HEADER_ORDER.filter((k) => shown.includes(k)).map((k) => KIND_WORD[k])
  const last = words.pop()
  return words.length === 0 ? `showing ${last}` : `showing ${words.join(', ')} and ${last}`
}
