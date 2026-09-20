import type { EditorView } from '@codemirror/view'
import { computeAccessibleName } from 'dom-accessibility-api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

/**
 * **EVERY CONTROL, AS A CLASS** — umbrella §8.1, Plan 7 part 2 spec §14. Rather than one test per control,
 * this walks every button and select the page holds, with every menu opened in turn, and asserts three things
 * of each: it has an accessible name that is not a bare glyph (rule 1), the name matches its visible label or
 * its tooltip (rule 1), and it is reachable by keyboard (rule 5). A control added later that breaks a rule
 * fails here without anyone having to remember to test it.
 */

/**
 * The accessible name, computed the way a browser computes it — `dom-accessibility-api` is the
 * accname spec as a function, and it is a dev dependency of `web/` for this gate.
 *
 * **NOT AN APPROXIMATION OF MY OWN, AND THE FIRST ONE HERE IS WHY.** This read `aria-label`, then a
 * wrapping `<label>`, then `textContent`, then `title` — which passes two things a reader would
 * actually hear as wrong, because it compares text content with itself: an appearance toggle whose
 * name was `◐system` (the glyph is a text node beside the word), and a menu item whose name ran two
 * spans together as `edit a copythe whole machine`. Both were in the tree when this gate first went
 * green (the pre-flight build's finding 12.2). A name computed independently of the visible-label
 * check below is what makes the comparison a check rather than a tautology.
 */
function nameOf(el: HTMLElement): string {
  return computeAccessibleName(el).trim()
}

/**
 * What a sighted user reads on the control: its text, minus anything hidden from assistive technology.
 * `aria-hidden` subtrees are decoration by declaration — the `◐` glyph, every `icons.ts` SVG — so text
 * inside one is not a label the name has to match.
 */
/**
 * What a sighted user reads beside a `<select>`: the text of the `<label>` wrapping it, if any, with the
 * select's own options left out.
 *
 * **WITHOUT THIS THE CHECK WAS A TAUTOLOGY.** It read the select's accessible NAME as its visible label
 * too, so `expect([visible, title]).toContain(name)` compared a value with itself and an `aria-label`
 * disagreeing with the words printed next to the control could not fail.
 *
 * **FOUR OF THE FIVE SELECTS ARE WRAPPED IN A LABEL, AND THIS PARAGRAPH USED TO SAY ALL OF THEM WERE —
 * whole-branch review, M6.** `encoding`, `style`, `palette` and `appearance` are wrapped, and the label
 * is where each one's name comes from when nothing overrides it, so for those four the comparison is
 * between two different sources again. The fifth is `step-controls.ts`'s SPEED select, which carries an
 * `aria-label` and no wrapping label at all; it falls through to the `el.title` branch below, so its
 * name (`aria-label`) and the text it is checked against (`title`) are still two different sources and
 * the check is still honest for it — but the enumeration was wrong, and a reader told every select was
 * label-wrapped would not know which branch that one takes.
 */
function selectLabel(el: HTMLElement): string {
  const label = el.closest('label')
  if (label === null) return el.title.trim()
  const copy = label.cloneNode(true) as HTMLElement
  for (const control of copy.querySelectorAll('select, [aria-hidden="true"]')) control.remove()
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function visibleLabel(el: HTMLElement): string {
  const copy = el.cloneNode(true) as HTMLElement
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  // **CHILD BY CHILD, JOINED WITH A SPACE, BECAUSE THAT IS WHAT THE NAME RULES DO — CONDITIONALLY.** A
  // control whose label and its second line are two spans has no whitespace between them in the markup,
  // so `textContent` runs them together (`edit a copythe whole machine`). The name computation inserts a
  // space between element children that are not `display: inline` — which is a rule about LAYOUT, so a
  // label side that depended on it would be as fragile as the name side. This side always joins; the
  // controls that would otherwise rely on the display rule write their name down with `aria-label`.
  return [...copy.childNodes]
    .map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((t) => t !== '')
    .join(' ')
}

/** A name with no letter or digit in it is a glyph, whatever it looks like. */
const isGlyph = (s: string) => !/[\p{L}\p{N}]/u.test(s)

/**
 * A symbol a reader would have to name aloud, inside a name that otherwise reads as words — `◐system`,
 * where a decorative glyph sits in a text node beside the word instead of being hidden from the name.
 *
 * **`+` IS THE ONE EXCEPTION, AND IT IS THE DESIGN'S OWN**: `+ view` reads as "plus view", which is the
 * button. Every other symbol this app draws is an `icons.ts` SVG, which carries `aria-hidden` and so
 * never reaches a name at all.
 *
 * **THE CHECK IS BOUNDED TO `\p{So}` AND `\p{Sm}`, AND NAMING WHAT THAT EXCLUDES IS THE POINT OF THIS
 * PARAGRAPH.** Those two are Unicode's symbol-other and symbol-math categories; `·` (U+00B7, `Po`) and
 * `—` (U+2014, `Pd`) are PUNCTUATION and pass straight through. Deliberately, because this app produces
 * both on purpose and in quantity — `λ · copy 1` from `view-header.ts`'s `pairLabel`, `resume λ copy 1
 * — restarts at step 0` from `buffer-list.ts`, `reset preset — restores the default views` from the
 * markup — where they separate clauses a reader runs together rather than standing in for a word. So a
 * green run here says no SYMBOL reached a name. It says nothing about punctuation, and widening the
 * class to catch `·` would fail on names the design asked for rather than on a defect.
 */
const straySymbol = (s: string) => /[\p{So}\p{Sm}]/u.test(s.replaceAll('+', ''))

/**
 * Every control a user can meet right now.
 *
 * **`closest('[hidden]')`, NOT `el.hidden` — the difference is a whole panel.** A collapsed or unmounted
 * panel hides its own element (`pane-chrome.ts`'s `textPanel` hides the panel until an editor is
 * mounted), and its toggle inside it reads `hidden === false` while being unreachable and unseen. The
 * first version of this filter asked the button, passed it, and then passed it again on a `tabIndex`
 * that reads 0 inside a hidden subtree; asking whether anything above it is hidden is what makes the
 * reachability check below mean what it says.
 */
function controls(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('button, select')].filter((el) => {
    if (el.closest('[hidden]') !== null) return false
    const popover = el.closest<HTMLElement>('[popover]')
    return popover === null || popover.matches(':popover-open')
  })
}

function check(where: string): void {
  for (const el of controls()) {
    const name = nameOf(el)
    const id = `${where}: <${el.tagName.toLowerCase()} class="${el.className}"> named ${JSON.stringify(name)}`
    expect(name, id).not.toBe('')
    expect(isGlyph(name), `${id} is a bare glyph`).toBe(false)
    expect(straySymbol(name), `${id} carries a symbol a reader would have to name aloud`).toBe(false)
    const visible = el.tagName === 'SELECT' ? selectLabel(el) : visibleLabel(el)
    if (visible !== '' && !isGlyph(visible))
      expect([visible, el.title.trim()], `${id}: name ≠ label or tooltip`).toContain(name)
    else expect(el.title.trim(), `${id}: a glyph-only control's tooltip must be its name`).toBe(name)
    // **FOCUSED, NOT ASKED ABOUT ITS `tabIndex`.** Measured in Chrome: `tabIndex` reads 0 for a disabled
    // button, a disabled select, and a button inside a `hidden`, `display: none`, `visibility: hidden`
    // or `inert` ancestor — so an assertion on it passes for every control this app can build, including
    // ones a keyboard genuinely cannot reach. Focusing says whether the control is reachable.
    if (el.matches(':disabled')) {
      // **A DISABLED CONTROL IS UNREACHABLE ON PURPOSE, SO IT IS NOT HELD TO REACHABILITY.** The
      // transport buttons are disabled whenever their leg has no history to walk, which is the project's
      // own rule and predates this part; *edit a copy* over `MAX_FORK_RULES` is the one the umbrella's
      // rule 4 is about, and `view-menu.test.ts` pins that it states its reason. What this gate still
      // holds a disabled control to is its NAME, asserted above — a control a reader cannot act on is
      // still a control they will hear.
    } else {
      el.focus()
      expect(document.activeElement, `${id} cannot take the focus`).toBe(el)
    }
  }
}

beforeAll(async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  // A copy, so the copies menu has rows and a view shows a copy's controls.
  document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
  await until(
    () => (document.querySelector('[data-leaf="lambda-0"] .view-title')?.textContent ?? '').includes('copy'),
    'the copy',
  )
})

/**
 * The four workspace states spec §14 item 5 names: the three presets, and one *custom* combination.
 *
 * **`views` IS WHAT CHANGES THE SELECTORS**, not `steps` or `readout`: in Stage one view is on the page,
 * so the per-view cases are driven from whichever view the stage is showing rather than from two named
 * leaves. The `custom` row is Explorer with one switch moved, and it is deliberately the switch that
 * changes the page most — a `custom` that looked like Explorer would walk the same controls twice.
 */
const STATES = [
  { name: 'Explorer', picks: ['[data-preset="explorer"]'], tiled: true },
  { name: 'Debugger', picks: ['[data-preset="debugger"]'], tiled: true },
  { name: 'Stage', picks: ['[data-preset="stage"]'], tiled: false },
  { name: 'custom', picks: ['[data-preset="explorer"]', '[data-switch="views"][data-value="stage"]'], tiled: false },
] as const

function enter(picks: readonly string[]): void {
  for (const sel of picks) {
    document.querySelector<HTMLButtonElement>('#workspace')?.click()
    document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
  }
  const menu = document.querySelector<HTMLElement>('#workspace-menu')
  if (menu?.matches(':popover-open')) menu.hidePopover()
}

/** The leaves a per-view case can be driven from in this state. */
function viewLeaves(tiled: boolean): string[] {
  if (tiled) return ['lambda-0', 'tm-0']
  const shown = document.querySelector<HTMLElement>('#views [role="tab"][aria-selected="true"]')
  return shown?.dataset.leaf === undefined ? [] : [shown.dataset.leaf]
}

describe.each(STATES)('every control in $name', ({ name, picks, tiled }) => {
  beforeAll(() => enter(picks))
  afterAll(() => enter(['[data-preset="explorer"]']))

  it('on the page as it stands', () => check(`${name}: page`))

  it.each([['#workspace'], ['#new-view'], ['#buffers'], ['#settings']])('with %s open', (selector) => {
    const button = document.querySelector<HTMLButtonElement>(selector)
    expect(button, selector).not.toBeNull()
    button?.click()
    check(`${name}: ${selector}`)
    const menu = document.getElementById(button?.getAttribute('aria-controls') ?? '')
    if (menu?.matches(':popover-open')) menu.hidePopover()
  })

  it("with every view's title and ⋯ menu open", () => {
    const leaves = viewLeaves(tiled)
    expect(leaves.length, `${name}: no view to walk`).toBeGreaterThan(0)
    for (const leaf of leaves) {
      for (const sel of [`[data-leaf="${leaf}"] button.view-title`, `[data-leaf="${leaf}"] button.view-more`]) {
        const button = document.querySelector<HTMLButtonElement>(sel)
        // A VIEW WITH ONE PAIR HAS A PLAIN-TEXT TITLE AND NO BUTTON (spec §7), and a view whose menu
        // would be empty has no `⋯` (`viewMenu`'s own rule) — both are absences the rules ALLOW, so a
        // missing control is skipped rather than failed.
        if (button === null) continue
        button.click()
        check(`${name}: ${sel}`)
        const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
        if (menu?.matches(':popover-open')) menu.hidePopover()
      }
    }
  })

  /**
   * **THE SPLIT SUBMENU IS A SECOND MENU INSIDE THE FIRST**, and the pass above never reaches it: `⋯`
   * shows the main items, and choosing *split right* hides those and builds the pair list in their
   * place. Those items are built from their text alone, with no tooltip — the one class of control here
   * whose name has nothing else to fall back on.
   *
   * **IN STAGE THE ABSENCE IS ASSERTED RATHER THAN ASSUMED** (spec §5). Without that assertion, a Stage
   * state in which the split items were still there would pass this case by never finding them, which is
   * the vacuous-negative failure spec §12 names for renames, arriving here instead.
   */
  it('with a split submenu open, where splits apply', () => {
    for (const leaf of viewLeaves(tiled)) {
      const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
      // **THE MENU'S OWN EXISTENCE IS ASSERTED, NOT OPTIONAL-CHAINED.** `viewMenu` removes `⋯` entirely
      // when nothing applies, so `more?.click()` on a null would open nothing and the `toBeNull()` below
      // would pass having proved only that a menu nobody opened contains no split items — the vacuous
      // negative this case's own doc claims to prevent.
      expect(more, `${name}: ${leaf} has no ⋯ menu to open`).not.toBeNull()
      more?.click()
      expect(
        document.querySelectorAll(`[data-leaf="${leaf}"] .view-menu-main button`).length,
        `${name}: ${leaf}'s menu opened empty`,
      ).toBeGreaterThan(0)
      const split = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-split[data-dir="row"]`)
      if (!tiled) {
        expect(split, `${name}: the stage must offer no split`).toBeNull()
        // AND THE MENU IS STILL WALKED: two of the four states reach this branch, and without this they
        // contributed one negative assertion and no control-name coverage at all.
        check(`${name}: ${leaf}'s ⋯ menu on the stage`)
      } else {
        expect(split, `${name}: ${leaf} offers no split`).not.toBeNull()
        split?.click()
        expect(document.querySelectorAll(`[data-leaf="${leaf}"] .view-menu-pairs button`).length).toBeGreaterThan(0)
        check(`${name}: ${leaf}'s split submenu`)
      }
      const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
      if (menu?.matches(':popover-open')) menu.hidePopover()
    }
  })
})

/**
 * **THE COPIES MENU'S OWN STATES STAY IN EXPLORER ALONE, AND THAT IS A DECISION.** What these two cases
 * exercise — a notice's *undo*, a paused copy's *resume* — is identical in all four workspace states:
 * the copies menu is an app-header popover that no switch touches. They also MUTATE the shared page
 * (delete then undo, pause then resume), so running them four times would be four rounds of state churn
 * for one signal. `check()` itself is state-agnostic; it enumerates whatever the page holds.
 */
describe('every control in Explorer, with the copies menu in each of its states', () => {
  /**
   * **A NOTICE'S ACTION BUTTON IS A CONTROL AND NEVER REACHED THIS GATE — whole-branch review, M8.**
   * Every other case here runs against a page whose notices carry no action, so `notice.ts`'s
   * `button.notice-action` — the *undo* a delete offers, the one control in the app that appears only
   * for eight seconds — was never name-checked or focus-checked. A delete puts one on screen; the
   * copies menu is left open afterwards by `handleDelete`, which is its own rule (§11) and means this
   * pass also sees a copies menu with one row fewer.
   */
  it('on the page as it stands, with a notice offering undo', () => {
    document.querySelector<HTMLButtonElement>('#buffers')?.click()
    document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label^="delete "]')?.click()
    const action = document.querySelector<HTMLButtonElement>('#notice button.notice-action')
    expect(action, 'the delete offered no undo to check').not.toBeNull()
    expect(nameOf(action as HTMLElement), 'the undo control is unnamed').toBe('undo')
    check('page with an undo notice')
    action?.click()
  })

  /**
   * **A PAUSED COPY'S ROW OFFERS A DIFFERENT CONTROL**, and the pass above only ever sees a running one:
   * `resume λ copy 1 — restarts at step 0` is never name-checked otherwise.
   */
  it('with a paused copy in the copies menu', () => {
    document.querySelector<HTMLButtonElement>('#buffers')?.click()
    document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label^="pause "]')?.click()
    expect(document.querySelector('.buffer-list button[aria-label^="resume "]')).not.toBeNull()
    check('#buffers with a paused copy')
    document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label^="resume "]')?.click()
    const menu = document.querySelector<HTMLElement>('.buffer-list')
    if (menu?.matches(':popover-open')) menu.hidePopover()
  })
})
