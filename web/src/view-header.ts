import { handOff, nearest } from './focus-handoff'
import { type IconName, icon } from './icons'
import type { Dir } from './layout'
import type { PaneChoice, SplitChoices } from './pane-chrome'
import type { Leg } from './protocol'
import type { SessionId } from './session-client'
import type { Binding, PaneOption } from './sessions'

/**
 * A VIEW'S HEADER — Plan 7 part 2 spec §7. Left to right: the title, which is the selector; the status;
 * the step controls; the view's actions (`⋯`, `✕`).
 *
 * **THE TITLE IS THE SELECTOR, AND IT REPLACES THREE THINGS.** A view used to carry an `<h2>` naming its
 * leg (`lambda`, `turing machine`), a `shows` select listing `(leg, session)` pairs under two optgroups,
 * and a `[detached]` badge. The inventory that opened Plan 7 found the select reading as a trivial choice
 * while picking the other leg rebuilt the whole view, with only an optgroup label saying so. Now the title
 * says what the view shows — `λ · program`, `TM · copy 2` — and opening it is how to show something else.
 *
 * **THE `<h2>` STAYS, AS THE TITLE'S CONTAINER.** A view is a section with a heading: the heading is what a
 * screen-reader user jumps between views by, and the status sits inside it as the badge did, so the two
 * facts about a view's identity — what it shows, and that it is a copy no longer linked to the program —
 * read together.
 *
 * **A PICK IS REPORTED, NOT PERFORMED.** `onPick` is `PaneEvents.rebind`, and `pane-host.ts` decides what a
 * pick across legs does (it rebuilds the view in place). This module knows nothing about the tree.
 */

const legLabel = (leg: Leg): string => (leg === 'lambda' ? 'λ' : 'TM')

/** How a pair reads everywhere a menu names one: `λ · program`, `TM · copy 2`. */
export function pairLabel(o: { readonly leg: Leg; readonly label: string }): string {
  return `${legLabel(o.leg)} · ${o.label}`
}

/**
 * The key a pair travels under — the menu items' `data-binding`, and the title's, which is what tests pick
 * and read by.
 *
 * **`:`, NOT THE `\x00` THE OLD `<option>` VALUES USED, BECAUSE THIS KEY IS MATCHED BY A CSS SELECTOR.**
 * CSS replaces U+0000 with U+FFFD when it parses a selector (and `CSS.escape` does the same), so
 * `button[data-binding="lambda\x00source"]` can never match the attribute it names. A leg never
 * contains `:` and comes first, so the first `:` splits the key exactly whatever the session id holds.
 */
export function bindingKey(leg: Leg, session: SessionId): string {
  return `${leg}:${session}`
}

export type ViewHeader = {
  readonly el: HTMLElement
  /** Where the step controls mount — each view's own, while the `steps` switch is `view`. */
  readonly steps: HTMLElement
  /** Where the view's actions mount: `⋯` and `✕`. */
  readonly actions: HTMLElement
  /** The pairs on offer and the one in force. On the per-frame path: a repeat call changes nothing. */
  setBindings(options: readonly PaneOption[], current: Binding<Leg>): void
  /** Whether the view shows a copy, which is not linked to the program. */
  setDetached(detached: boolean): void
  /**
   * Whether the step slot is in the header at all — spec §8's `steps` switch.
   *
   * **THE SLOT LEAVES THE DOM, IT IS NOT HIDDEN** (`PaneView.setStepsShown`'s own doc), and taking it out
   * from under a keyboard user is spec §11's fourth rule — which is why this is the setter and not a
   * class on the header.
   */
  setStepsShown(shown: boolean): void
}

/**
 * Unique ids for the title menus, so each title's `aria-controls` names exactly one menu — per module, for
 * the split picker's old reason: every view on the page builds one.
 */
let menuSeq = 0

/** The `<header>`, its heading, and the two slots — shared by `viewHeader` and `sourceViewHeader`. */
function frame(): { el: HTMLElement; heading: HTMLElement; steps: HTMLElement; actions: HTMLElement } {
  const el = document.createElement('header')
  el.className = 'view-header'
  const heading = document.createElement('h2')
  heading.className = 'view-title-heading'
  const steps = document.createElement('div')
  steps.className = 'view-steps'
  const actions = document.createElement('div')
  actions.className = 'view-actions'
  el.append(heading, steps, actions)
  return { el, heading, steps, actions }
}

export function viewHeader(onPick: (choice: Binding<Leg>) => void): ViewHeader {
  const { el, heading, steps, actions } = frame()

  const menu = document.createElement('div')
  menu.className = 'view-title-menu'
  menu.id = `view-title-menu-${menuSeq++}`
  menu.popover = 'auto'

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'view-title'
  button.title = 'choose what this view shows'
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-controls', menu.id)
  // STATED FROM CONSTRUCTION, NOT FROM THE FIRST TOGGLE — `viewMenu`'s reason: a disclosure with no
  // `aria-expanded` announces as a plain button to the reader who most needs to know it opens something.
  button.setAttribute('aria-expanded', 'false')
  button.popoverTargetElement = menu
  const buttonText = document.createElement('span')
  const caret = icon('disclose')
  caret.classList.add('view-title-caret')
  button.append(buttonText, caret)

  const plain = document.createElement('span')
  plain.className = 'view-title'

  const status = document.createElement('span')
  status.className = 'view-status'
  status.textContent = 'copy · not linked'
  status.title = 'this view shows a copy, which is not linked to the program'

  let options: readonly PaneOption[] = []
  let current: Binding<Leg> | null = null
  let rendered = ''
  let detached = false
  let stepsShown = true

  // BUILT ON OPEN, NOT PER FRAME — `viewMenu`'s rule, which `pane-chrome.ts` stated for the same
  // per-frame reason: `draw()` repaints every view on every recorded frame during playback, and a menu that
  // is closed has no state to keep fresh. The first item takes `autofocus`, which the popover's own show
  // steps honour after it is visible; `.focus()` here would run while it is still `display: none`.
  menu.addEventListener('beforetoggle', (e) => {
    const open = e.newState === 'open'
    button.setAttribute('aria-expanded', String(open))
    if (!open) return
    const items = options.map((o) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = pairLabel(o)
      b.dataset.binding = bindingKey(o.leg, o.id)
      if (current !== null && o.leg === current.leg && o.id === current.session) b.setAttribute('aria-current', 'true')
      b.addEventListener('click', () => {
        menu.hidePopover()
        onPick({ leg: o.leg, session: o.id })
      })
      return b
    })
    menu.replaceChildren(...items)
    const first = items[0]
    if (first !== undefined) first.autofocus = true
  })

  /**
   * Put the heading in the state the fields describe.
   *
   * **IT RECONCILES RATHER THAN REPLACING, AND THAT IS A FOCUS RULE, NOT A COST ONE.** This was
   * `heading.replaceChildren(control, …)`, which removes every child and re-inserts it — including the
   * title button, the same element, unchanged. **Removing the focused element from the document resets
   * focus to `<body>`, and putting it back does not bring the focus with it.** So every repaint blurred a
   * focused title: on the same-leg pick the title itself had just performed (the one rebind arm with no
   * `focusPane` behind it, because the view stays exactly where it was), on a detach or reattach, and on
   * any other view's copy being created — every view's key changes when the session list does.
   *
   * Spec §11 is categorical about it, and `pane-host.ts`'s same-leg arm relies on this function to keep
   * the promise. `view-title.test.ts`'s "keeps the focus on the title it was picked from" holds it.
   *
   * **THE MENU IS LEFT ALONE UNLESS IT HAS TO MOVE**, for the same reason one step out: a popover taken
   * out of the DOM is a popover closed, so rebuilding on a key change would shut the menu under a reader
   * mid-choice — which the rendered-key guard only prevents for exact repeats.
   */
  const paint = (): void => {
    const mine = current === null ? undefined : options.find((o) => o.leg === current?.leg && o.id === current.session)
    const text = mine === undefined ? '' : pairLabel(mine)
    const control = options.length < 2 ? plain : button
    if (control === button) {
      buttonText.textContent = text
      if (current !== null) button.dataset.binding = bindingKey(current.leg, current.session)
    } else {
      plain.textContent = text
    }
    const other = control === button ? plain : button
    other.remove()
    if (control.parentNode !== heading) heading.prepend(control)
    if (detached) {
      if (status.parentNode !== heading) heading.append(status)
    } else {
      status.remove()
    }
    if (control === button) {
      if (menu.parentNode === null) heading.after(menu)
    } else {
      menu.remove()
    }
  }

  return {
    el,
    steps,
    actions,
    setBindings(next: readonly PaneOption[], now: Binding<Leg>): void {
      // THE RENDERED KEY, AS THE OLD `shows` SELECT KEPT ONE: a repeat call on the per-frame path is free, and an
      // open menu is not torn out from under a reader mid-choice.
      const key = `${next.map((o) => `${bindingKey(o.leg, o.id)}\x00${o.label}`).join('\x01')}\x02${bindingKey(now.leg, now.session)}`
      if (key === rendered) return
      rendered = key
      options = next
      current = now
      paint()
    },
    setDetached(next: boolean): void {
      if (next === detached) return
      detached = next
      paint()
    },
    setStepsShown(shown: boolean): void {
      if (shown === stepsShown) return
      stepsShown = shown
      if (shown) {
        // BEFORE THE ACTIONS, so the header keeps spec §7's order: title · status · step controls · ⋯ · ✕.
        el.insertBefore(steps, actions)
        return
      }
      // A CONTROL REMOVED BY A STATE CHANGE MUST NOT TAKE THE FOCUS WITH IT — spec §11's fourth rule, the
      // same rule the continue button already follows, applied to a whole SLOT rather than one button
      // (`focus-handoff.ts`). Reached by a user standing on `▶` who flips the `steps` switch in the
      // header's own menu: without this, focus falls to `<body>`.
      handOff(steps, nearest(el, steps))
      steps.remove()
    },
  }
}

/** The source view's header: its title, `source`, as plain text — there is one editor and nothing to pick. */
export function sourceViewHeader(): { readonly el: HTMLElement; readonly actions: HTMLElement } {
  const { el, heading, steps, actions } = frame()
  steps.remove()
  const title = document.createElement('span')
  title.className = 'view-title'
  title.textContent = 'source'
  heading.append(title)
  return { el, actions }
}

/**
 * What `✎ edit a copy` can do right now: not offered (`null`), offered, or offered and disabled with its
 * reason — the one control that is disabled rather than removed, because the refusal is a size and not an
 * absence (`MAX_FORK_RULES`; umbrella §4 rule 4).
 */
export type CopyState = null | 'ready' | { readonly reason: string }

export type ViewMenu = {
  /** Whether `✕` applies (not on the last view) and whether the split items do (not on the source view). */
  setLayout(canClose: boolean, canSplit: boolean): void
  setCopy(state: CopyState): void
  /** Whether `move the editor here` applies: the view shows a copy whose editor is elsewhere. */
  setClaim(available: boolean): void
}

export type ViewMenuOptions = {
  readonly split?: (dir: Dir, choice: PaneChoice) => void
  readonly close?: () => void
  /** `what` is the second line: what is copied — "the term at this step", "the whole machine". */
  readonly editCopy?: { readonly run: () => void; readonly what: string }
  readonly claim?: () => void
  readonly choices?: () => SplitChoices
}

let viewMenuSeq = 0

/** One menu item: an optional icon, its label, and an optional second line. */
function item(className: string, label: string, hint?: string, glyph?: IconName): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = className
  if (glyph !== undefined) b.append(icon(glyph))
  const l = document.createElement('span')
  l.className = 'view-menu-label'
  l.textContent = label
  b.append(l)
  if (hint !== undefined) {
    const h = document.createElement('span')
    h.className = 'view-menu-hint'
    h.textContent = hint
    b.append(h)
    // **THE NAME IS WRITTEN DOWN RATHER THAN LEFT TO THE LAYOUT, AND THAT IS NOT BELT-AND-BRACES.** What
    // is copied — or why it cannot be — belongs in the name: it is what a reader needs before choosing
    // the item. Built from the content, the name would join these two spans with a space only while they
    // are not `display: inline` (accname's rule, and `dom-accessibility-api` implements it as
    // `separator = display !== 'inline' ? ' ' : ''`) — so it would read `edit a copythe whole machine`
    // the day `.view-menu button`'s `display: grid` changed, with no test and no gate able to say why.
    // An `aria-label` costs one line and says it outright; `sync` below keeps it in step with the hint.
    b.setAttribute('aria-label', `${label} ${hint}`)
  }
  return b
}

/**
 * A view's `⋯` menu and its `✕` — Plan 7 part 2 spec §7.
 *
 * **ONE GLYPH, ONE MEANING (umbrella §4 rule 2).** `⋯` only ever opens a view's menu and `✕` only ever closes a
 * view. The two split popovers (`⇥`, `⤓`), `✎ fork` and the claim button were four more controls in a view's
 * strip; they are menu items now, because none of them is a thing a user does every few seconds.
 *
 * **THE ITEMS STAY IN THE DOM WHILE THE MENU IS CLOSED, ADDED AND REMOVED AS THEY APPLY.** That is this file's
 * idiom for a control that cannot apply (removed, not disabled — rule 4), applied inside a popover: the popover
 * hides them, and nothing is built per frame. `⋯` itself is removed when the menu would be empty.
 *
 * **A SPLIT IS TWO CHOICES IN ONE MENU.** Choosing *split right* or *split down* replaces the main items with
 * the pairs a new view could show, the view's own pair first and reading *another view of this*, then the
 * others, then *source* while the tree has none. The pair list is built at that moment from `choices()`,
 * which is a thunk for the old split picker's reason: the list is read when it is needed and never per frame.
 * Closing the menu puts the main items back.
 *
 * **EVERY ITEM CLOSES THE MENU BEFORE IT RUNS**, so no item is left on screen describing a view the action
 * just changed, and focus returns to `⋯` — the popover's own behaviour on a light dismiss or a `hidePopover`
 * while focus is inside it.
 */
export function viewMenu(actions: HTMLElement, opts: ViewMenuOptions): ViewMenu {
  const n = viewMenuSeq++
  const menu = document.createElement('div')
  menu.className = 'view-menu'
  menu.id = `view-menu-${n}`
  menu.popover = 'auto'
  const main = document.createElement('div')
  main.className = 'view-menu-main'
  const pairs = document.createElement('div')
  pairs.className = 'view-menu-pairs'
  menu.append(main, pairs)

  const more = document.createElement('button')
  more.type = 'button'
  more.className = 'view-more'
  more.append(icon('more'))
  more.title = 'view actions'
  more.setAttribute('aria-label', 'view actions')
  more.setAttribute('aria-haspopup', 'menu')
  more.setAttribute('aria-controls', menu.id)
  more.setAttribute('aria-expanded', 'false')
  more.popoverTargetElement = menu

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'view-close'
  close.append(icon('close'))
  close.title = 'close this view'
  close.setAttribute('aria-label', 'close this view')
  if (opts.close !== undefined) {
    const onClose = opts.close
    close.addEventListener('click', onClose)
  }

  const shut = (): void => {
    if (menu.matches(':popover-open')) menu.hidePopover()
  }

  const splitItems: HTMLButtonElement[] = []
  if (opts.split !== undefined && opts.choices !== undefined) {
    const split = opts.split
    const choices = opts.choices
    for (const [dir, label] of [
      ['row', 'split right'],
      ['column', 'split down'],
    ] as const) {
      const b = item('view-split', label)
      b.dataset.dir = dir
      b.addEventListener('click', () => {
        const { options, sourceAvailable, current } = choices()
        const built: HTMLButtonElement[] = []
        const add = (text: string, choice: PaneChoice, mark: (el: HTMLButtonElement) => void) => {
          const p = document.createElement('button')
          p.type = 'button'
          p.textContent = text
          mark(p)
          p.addEventListener('click', () => {
            shut()
            split(dir, choice)
          })
          built.push(p)
        }
        const mine = options.find((o) => o.leg === current?.leg && o.id === current?.session)
        if (mine !== undefined)
          add('another view of this', { kind: mine.leg, session: mine.id }, (p) => {
            p.dataset.same = ''
            p.dataset.binding = bindingKey(mine.leg, mine.id)
          })
        for (const o of options) {
          if (o === mine) continue
          add(pairLabel(o), { kind: o.leg, session: o.id }, (p) => {
            p.dataset.binding = bindingKey(o.leg, o.id)
          })
        }
        if (sourceAvailable)
          add('source', { kind: 'source' }, (p) => {
            p.dataset.source = ''
          })
        main.hidden = true
        pairs.replaceChildren(...built)
        built[0]?.focus()
      })
      splitItems.push(b)
    }
  }

  const edit = opts.editCopy === undefined ? null : item('detach', 'edit a copy', opts.editCopy.what, 'edit')
  if (edit !== null && opts.editCopy !== undefined) {
    const run = opts.editCopy.run
    edit.addEventListener('click', () => {
      shut()
      run()
    })
  }
  const claim =
    opts.claim === undefined ? null : item('claim-editor', 'move the editor here', undefined, 'move-editor-here')
  if (claim !== null && opts.claim !== undefined) {
    const run = opts.claim
    claim.addEventListener('click', () => {
      shut()
      run()
    })
  }

  menu.addEventListener('beforetoggle', (e) => {
    const open = e.newState === 'open'
    more.setAttribute('aria-expanded', String(open))
    if (open) {
      const first = main.querySelector<HTMLButtonElement>('button:not([disabled])')
      if (first !== null) first.autofocus = true
      return
    }
    pairs.replaceChildren()
    main.hidden = false
  })

  let canClose = false
  let canSplit = false
  let copy: CopyState = null
  let claimable = false
  const what = opts.editCopy?.what ?? ''

  const sync = (): void => {
    const wanted: HTMLButtonElement[] = []
    if (canSplit) wanted.push(...splitItems)
    if (edit !== null && copy !== null) {
      // THE HINT LINE AND THE NAME MOVE TOGETHER — see `item`'s own note on why the name is written down.
      const line = copy === 'ready' ? what : copy.reason
      const hint = edit.querySelector('.view-menu-hint')
      if (hint !== null) hint.textContent = line
      edit.setAttribute('aria-label', `edit a copy ${line}`)
      if (copy === 'ready') {
        edit.disabled = false
        edit.removeAttribute('aria-description')
      } else {
        edit.disabled = true
        edit.setAttribute('aria-description', copy.reason)
      }
      wanted.push(edit)
    }
    if (claim !== null && claimable) wanted.push(claim)
    // RECONCILED, NOT REPLACED, FOR `paint`'s REASON ONE LEVEL OUT: `replaceChildren` takes every item
    // out of the document, and an item holding the focus does not get it back. Reachable while the menu
    // is open and a frame changes what applies — a copy created elsewhere, a recording ending.
    const same = wanted.length === main.children.length && wanted.every((b, i) => main.children[i] === b)
    if (!same) {
      const going = [...main.children].filter((child) => !wanted.includes(child as HTMLButtonElement))
      // A CONTROL REMOVED BY A STATE CHANGE MUST NOT TAKE THE FOCUS WITH IT — spec §11's fourth rule, at
      // the instance the spec names by hand: the split items when Stage is chosen. It is reachable with
      // the menu OPEN, which is the only way a user can be standing on one of these when the state
      // changes. `main` is "the same menu"; the candidates are filtered against `going` because `nearest`
      // walks the menu as it stands BEFORE the removal, so a departing sibling is still connected and
      // would otherwise be handed the focus a moment before it leaves too.
      if (going.length > 0) {
        const candidates = nearest(main, going[0] as Element).filter((el) => !going.includes(el))
        handOff(going, candidates)
      }
      for (const child of going) child.remove()
      for (const [i, b] of wanted.entries()) {
        const at = main.children[i]
        if (at === b) continue
        if (at === undefined) main.append(b)
        else main.insertBefore(b, at)
      }
    }
    const showMore = wanted.length > 0
    if (showMore && more.parentNode === null) actions.prepend(more, menu)
    if (!showMore && more.parentNode !== null) {
      shut()
      more.remove()
      menu.remove()
    }
    if (canClose && close.parentNode === null && opts.close !== undefined) actions.append(close)
    if (!canClose && close.parentNode !== null) close.remove()
  }

  return {
    setLayout(nextClose: boolean, nextSplit: boolean): void {
      if (nextClose === canClose && nextSplit === canSplit) return
      canClose = nextClose
      canSplit = nextSplit
      sync()
    },
    setCopy(next: CopyState): void {
      const key = (s: CopyState) => (s === null ? 'none' : s === 'ready' ? 'ready' : `reason:${s.reason}`)
      if (key(next) === key(copy)) return
      copy = next
      sync()
    },
    setClaim(next: boolean): void {
      if (next === claimable) return
      claimable = next
      sync()
    },
  }
}
