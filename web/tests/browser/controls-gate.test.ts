import type { EditorView } from '@codemirror/view'
import { computeAccessibleName } from 'dom-accessibility-api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { HEADER_ORDER, KIND_WORD } from '../../src/layout'
import { DAY, EMBER, legacyLayout } from '../node/base16-fixtures'
import { base16Dialog, SHELL, selectedTab, stageTab, stateIdle, tabLeaves, until } from './harness'

/**
 * **EVERY CONTROL, AS A CLASS** — umbrella §8.1, Plan 7 part 2 spec §14. Rather than one test per control,
 * this walks every button, select, input and text area the page holds, with every menu and dialog opened in turn,
 * and asserts three things
 * of each: it has an accessible name that is not a bare glyph (rule 1), the name matches its visible label or
 * its tooltip (rule 1), and it is reachable by keyboard (rule 5). A control added later that breaks a rule
 * fails here without anyone having to remember to test it.
 */

/**
 * The accessible name, computed the way a browser computes it — `dom-accessibility-api` is the
 * accname spec as a function, and it is a dev dependency of `web/` for this gate.
 *
 * **NOT AN APPROXIMATION OF MY OWN.** One that read `aria-label`, then a wrapping `<label>`, then
 * `textContent`, then `title` would pass two things a reader would actually hear as wrong, because it
 * compares text content with itself: an appearance toggle named `◐system` (the glyph a text node beside
 * the word), and a menu item whose label and second line, two spans, run together into one word. A
 * name computed independently of the visible-label check below is what makes the comparison a check
 * rather than a tautology.
 */
function nameOf(el: HTMLElement): string {
  return computeAccessibleName(el).trim()
}

/**
 * What a sighted user reads beside a form control — a `<select>`, an `<input>` or a `<textarea>`: the text of the
 * `<label>` wrapping it, if any, with the control itself left out (Plan 7 part 6b spec §10). A select's options
 * and a text area's text are the control's value, not its label.
 *
 * **WITHOUT THIS THE CHECK WOULD BE A TAUTOLOGY.** Reading the select's accessible NAME as its visible
 * label too, `expect([visible, title]).toContain(name)` would compare a value with itself, and an
 * `aria-label` disagreeing with the words printed next to the control could not fail.
 *
 * **EVERY SELECT BUT SPEED IS WRAPPED IN A LABEL.** `encoding`, `style`, `palette`, `appearance` and
 * `keymap` are wrapped, and the label is where each one's name comes from when nothing overrides it, so
 * for those five the comparison is between two different sources again. `step-controls.ts`'s SPEED
 * select carries an `aria-label` and no wrapping label at all; it falls through to the `el.title` branch
 * below, so its name (`aria-label`) and the text it is checked against (`title`) are still two different
 * sources and the check is still honest for it too.
 *
 * **THIS IS AN ENUMERATION NOTHING HERE CHECKS.** `check()` walks whatever selects the DOM holds; it
 * never reads this paragraph or counts them against it. Naming the wrapped ones by convention ("every
 * select but SPEED") survives a select being added without an edit here, but a select that broke the
 * convention — wrapped where SPEED-like, or bare where the others are — would still pass silently. The
 * next person to add a select to this app should update this paragraph and should not expect a red test
 * to remind them.
 */
function selectLabel(el: HTMLElement): string {
  const label = el.closest('label')
  if (label === null) return el.title.trim()
  const copy = label.cloneNode(true) as HTMLElement
  for (const control of copy.querySelectorAll('select, input, textarea, [aria-hidden="true"]')) control.remove()
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * What a sighted user reads on the control: its text, minus anything hidden from assistive technology.
 * `aria-hidden` subtrees are decoration by declaration — the `◐` glyph, every `icons.ts` SVG — so text
 * inside one is not a label the name has to match.
 */
function visibleLabel(el: HTMLElement): string {
  const copy = el.cloneNode(true) as HTMLElement
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  // **CHILD BY CHILD, JOINED WITH A SPACE, BECAUSE THAT IS WHAT THE NAME RULES DO — CONDITIONALLY.** A
  // control whose label and its second line are two spans has no whitespace between them in the markup,
  // so `textContent` runs them together into one word. The name computation inserts a
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
 * **`+` IS AN EXCEPTION, AND IT IS PROGRAM TEXT, AS `=` IS BELOW**: the example titled `let x = 40; x + 2` names
 * itself by the program, whose `+` a reader says as "plus". Every other symbol this app draws as decoration is an
 * `icons.ts` SVG, which carries `aria-hidden` and so never reaches a name at all.
 *
 * **THE CHECK IS BOUNDED TO `\p{So}` AND `\p{Sm}`, AND NAMING WHAT THAT EXCLUDES IS THE POINT OF THIS
 * PARAGRAPH.** Those two are Unicode's symbol-other and symbol-math categories; `·` (U+00B7, `Po`) and
 * `—` (U+2014, `Pd`) are PUNCTUATION and pass straight through. Deliberately, because this app produces
 * both on purpose and in quantity — `λ · program` from `view-header.ts`'s `pairLabel`, `reset preset — restores
 * the default views` from the markup — where they separate clauses a reader runs together rather than standing in
 * for a word. So a green run here says no SYMBOL reached a name. It says nothing about punctuation, and widening the
 * class to catch `·` would fail on names the design asked for rather than on a defect.
 *
 * **`=` IS THE SECOND EXCEPTION, AND IT IS PROGRAM TEXT (Plan 7 part 6a spec §6).** An example in `examples ▾`
 * is named by its title, and one title is the program `let x = 40; x + 2`: its `=` is not a glyph standing in for
 * a word but the program's own operator, which a reader says as "equals", as they say its `+`.
 */
const straySymbol = (s: string) => /[\p{So}\p{Sm}]/u.test(s.replaceAll('+', '').replaceAll('=', ''))

/**
 * Every control a user can meet right now: every button, select, input and textarea but a hidden input, which no one
 * meets (Plan 7 part 6a spec §6).
 *
 * **WHILE A MODAL DIALOG IS OPEN, ONLY WHAT IS INSIDE IT** (Plan 7 part 6b spec §10). The platform makes everything
 * outside a modal inert, so every control there would fail the focus check below for that reason alone; and a
 * control inside a CLOSED dialog is as unreachable as one inside a closed popover.
 *
 * **`closest('[hidden]')`, NOT `el.hidden` — the difference is a whole region.** A collapsed panel hides its body, and
 * a control in that body reads `hidden === false` while being unreachable and unseen; so does one under any other
 * hidden ancestor, such as a `machine-row.ts` region whose panel is in the row. A filter that asked the button would
 * pass it; asking whether anything above it is hidden is what makes the reachability check below mean what it says.
 */
function controls(): HTMLElement[] {
  const scope: ParentNode = document.querySelector('dialog:modal') ?? document
  return [...scope.querySelectorAll<HTMLElement>('button, select, input, textarea, a[href]')].filter((el) => {
    if (el.matches('input[type="hidden"]')) return false
    if (el.closest('[hidden]') !== null) return false
    if (el.closest('dialog:not([open])') !== null) return false
    const popover = el.closest<HTMLElement>('[popover]')
    return popover === null || popover.matches(':popover-open')
  })
}

/** Hold every control on the page to the rules, and answer the ones it held. */
function check(where: string): HTMLElement[] {
  const walked = controls()
  for (const el of walked) {
    const name = nameOf(el)
    const id = `${where}: <${el.tagName.toLowerCase()} class="${el.className}"> named ${JSON.stringify(name)}`
    expect(name, id).not.toBe('')
    expect(isGlyph(name), `${id} is a bare glyph`).toBe(false)
    expect(straySymbol(name), `${id} carries a symbol a reader would have to name aloud`).toBe(false)
    const visible = el.matches('select, input, textarea') ? selectLabel(el) : visibleLabel(el)
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
      // own rule. What this gate still holds a disabled control to is its NAME, asserted above — a control a
      // reader cannot act on is still a control they will hear.
    } else if (el.tabIndex === -1 && el.closest('[role="row"]') !== null) {
      // **A CONTROL OUT OF THE TAB ORDER IN A GRID'S ROW IS NEVER FOCUSED BY A USER, SO IT IS HELD TO ITS NAME
      // ALONE.** The grid is its level's one tab stop, a mousedown on its rows is cancelled (`VirtualGrid`), and
      // the row's Enter does what the control does: the TM view's *show states* (`state-diagram.ts`). Focusing
      // one here redraws its rows, which takes it out of the document, with or without `preventScroll`, and
      // leaves the focus on `<body>`. A run opens on step 0, whose group has a *show states* row.
    } else {
      el.focus()
      expect(document.activeElement, `${id} cannot take the focus`).toBe(el)
    }
  }
  return walked
}

beforeAll(async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(stateIdle, 'the first compile')
})

/**
 * The four workspace states spec §14 item 5 names: the three presets, and one *custom* combination.
 *
 * **`views` IS WHAT CHANGES THE SELECTORS**, not `steps` or `readout`: in Stage one view is on the page,
 * so the per-view cases select each tab in turn and drive the view it shows (`eachView`). The `custom` row is
 * Explorer with one switch moved, and it is deliberately the switch that changes the page most — a `custom` that
 * looked like Explorer would walk the same controls twice.
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

/**
 * The leaves a per-view case is driven from in this state: every view but the source's, read off the page when tiled
 * and off the tabs in the stage, which puts one view on the page at a time.
 *
 * **READ OFF THE PAGE, NOT LISTED**: a list of the views there were is a list that misses the next one, and the gate
 * would stay green while walking none of its controls. Every view host is a `.pane` with its leaf id; the source's is
 * the one leaf with no title menu to open.
 */
function viewLeaves(tiled: boolean): string[] {
  const leaves = tiled
    ? [...document.querySelectorAll<HTMLElement>('.pane[data-leaf]')].map((host) => host.dataset.leaf ?? '')
    : tabLeaves()
  return leaves.filter((leaf) => leaf !== '' && leaf !== 'source')
}

/**
 * Hand each of `viewLeaves` to `walk` with its view on the page, in the stage by selecting its tab, then the one that
 * was. **EVERY TAB, NOT THE SHOWN ONE**: a stage view whose menu holds nothing has no `⋯`, so a walk of the shown tab
 * alone could walk nothing.
 */
function eachView(tiled: boolean, walk: (leaf: string) => void): void {
  const leaves = viewLeaves(tiled)
  if (tiled) {
    for (const leaf of leaves) walk(leaf)
    return
  }
  const shown = selectedTab()
  try {
    for (const leaf of leaves) {
      stageTab(leaf).click()
      walk(leaf)
    }
  } finally {
    if (shown !== undefined) stageTab(shown).click()
  }
}

describe.each(STATES)('every control in $name', ({ name, picks, tiled }) => {
  beforeAll(() => enter(picks))
  afterAll(() => enter(['[data-preset="explorer"]']))

  it('on the page as it stands', () => check(`${name}: page`))

  /**
   * **EVERY HEADER MENU, READ OFF THE PAGE RATHER THAN LISTED** — `viewLeaves`' reason: a list of the menus there were
   * is a list that misses the next one. Every header menu is asserted among the ones walked, the about menu by its
   * link below, so the loop cannot pass by walking fewer — and `share`'s popover, a disclosure and not a menu, but
   * opened as one is by a header button naming it in `aria-controls`, and holding a field the walk reads by its label.
   */
  it('with each header menu open', () => {
    const openers = [...document.querySelectorAll<HTMLButtonElement>('header.bar button[aria-controls]')]
    expect(openers.map((b) => b.id)).toEqual(expect.arrayContaining(['workspace', 'examples', 'share', 'settings']))
    const walked: string[] = []
    let inWorkspaceMenu: HTMLElement[] = []
    for (const button of openers) {
      button.click()
      const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
      // A MENU THAT NEVER OPENED IS A MENU WHOSE CONTROLS WERE NEVER WALKED — and a header button that opens nothing.
      expect(menu?.matches(':popover-open'), `${name}: #${button.id} opened nothing`).toBe(true)
      const read = check(`${name}: #${button.id}`)
      walked.push(...read.map((el) => el.id))
      if (button.id === 'workspace') inWorkspaceMenu = read
      if (menu?.matches(':popover-open')) menu.hidePopover()
    }
    // THE `views` TOGGLES ARE WALKED IN THE WORKSPACE MENU, where this window's width puts them; they have no ids.
    const toggles = [...document.querySelectorAll<HTMLElement>('#views-shown button')]
    expect(toggles).toHaveLength(HEADER_ORDER.length)
    for (const t of toggles)
      expect(inWorkspaceMenu, `${name}: the workspace menu's walk skipped the ${t.textContent} toggle`).toContain(t)
    // A FORM CONTROL THAT IS NOT A SELECT IS WALKED: the settings menu's checkbox, which `button, select` alone would
    // not reach, and the share popover's field.
    expect(walked).toContain('format-on-blur')
    expect(walked).toContain('share-link')
    // A LINK IS WALKED: the about menu's, which `button, select, input, textarea` alone would not reach.
    expect(walked).toContain('about-source')
  })

  it("with every view's title and ⋯ menu open", () => {
    const leaves = viewLeaves(tiled)
    expect(leaves.length, `${name}: no view to walk`).toBeGreaterThan(0)
    // THE WALK REACHES EVERY KIND OF VIEW THE FOUR-VIEW PAGE HAS, the rxm view too, in tiles or by the stage's tabs.
    expect(leaves, `${name}: the views walked`).toEqual(['lambda-0', 'rxm-0', 'tm-0'])
    let opened = 0
    eachView(tiled, (leaf) => {
      for (const sel of [`[data-leaf="${leaf}"] button.view-title`, `[data-leaf="${leaf}"] button.view-more`]) {
        const button = document.querySelector<HTMLButtonElement>(sel)
        // A VIEW WITH ONE PAIR HAS A PLAIN-TEXT TITLE AND NO BUTTON (spec §7), and a view whose menu
        // would be empty has no `⋯` (`viewMenu`'s own rule) — both are absences the rules ALLOW, so a
        // missing control is skipped rather than failed.
        if (button === null) continue
        button.click()
        opened += 1
        check(`${name}: ${sel}`)
        const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
        if (menu?.matches(':popover-open')) menu.hidePopover()
      }
    })
    expect(opened, `${name}: no view had a title menu or a ⋯ to open`).toBeGreaterThan(0)
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
    const bare: string[] = []
    eachView(tiled, (leaf) => {
      const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
      // **THE MENU'S OWN EXISTENCE IS ASSERTED, NOT OPTIONAL-CHAINED.** `viewMenu` removes `⋯` entirely
      // when nothing applies, so `more?.click()` on a null would open nothing and the `toBeNull()` below
      // would pass having proved only that a menu nobody opened contains no split items — the vacuous
      // negative this case's own doc claims to prevent. **BUT ON THE STAGE A VIEW WHOSE MENU HOLDS NOTHING HAS NONE**,
      // as no split or close applies there: the TM and rxm views', which are named after the walk, not skipped.
      if (!tiled && more === null) {
        bare.push(leaf)
        return
      }
      expect(more, `${name}: ${leaf} has no ⋯ menu to open`).not.toBeNull()
      more?.click()
      expect(
        document.querySelectorAll(`[data-leaf="${leaf}"] .view-menu-main button`).length,
        `${name}: ${leaf}'s menu opened empty`,
      ).toBeGreaterThan(0)
      const split = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-split[data-dir="row"]`)
      if (!tiled) {
        expect(split, `${name}: the stage must offer no split`).toBeNull()
        // AND THE MENU IS STILL WALKED: two of the four states reach this branch, and without this they would
        // contribute one negative assertion and no control-name coverage at all.
        check(`${name}: ${leaf}'s ⋯ menu on the stage`)
      } else {
        expect(split, `${name}: ${leaf} offers no split`).not.toBeNull()
        split?.click()
        expect(document.querySelectorAll(`[data-leaf="${leaf}"] .view-menu-pairs button`).length).toBeGreaterThan(0)
        check(`${name}: ${leaf}'s split submenu`)
      }
      const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
      if (menu?.matches(':popover-open')) menu.hidePopover()
    })
    // ONLY THESE HAD NO `⋯` ON THE STAGE, so every other view walked went through the stage branch above.
    if (!tiled) expect(bare, `${name}: the views with no ⋯ on the stage`).toEqual(['rxm-0', 'tm-0'])
  })
})

/**
 * **A NOTICE'S UNDO STAYS IN EXPLORER ALONE, AND THAT IS A DECISION.** The notice line is the app header's, which no
 * switch touches, so the case is identical in all four workspace states; it also MUTATES the shared page (an example
 * opened, then put back), so running it four times would be four rounds of state churn for one signal. `check()`
 * itself is state-agnostic; it enumerates whatever the page holds.
 */
describe('every control in Explorer, with a notice offering undo', () => {
  /**
   * **A NOTICE'S ACTION BUTTON IS A CONTROL, AND ONLY THIS CASE REACHES IT.** Every other case here runs against
   * a page whose notices carry no action, so `notice.ts`'s `button.notice-action` — here the *undo* an example's
   * pick offers, a control on the page only while its notice lasts — is name-checked and focus-checked here alone.
   */
  it('on the page as it stands, with a notice offering undo', () => {
    document.querySelector<HTMLButtonElement>('#examples')?.click()
    document.querySelector<HTMLButtonElement>('#examples-menu button[data-example="arithmetic"]')?.click()
    const action = document.querySelector<HTMLButtonElement>('#notice button.notice-action')
    expect(action, 'the pick offered no undo to check').not.toBeNull()
    expect(nameOf(action as HTMLElement), 'the undo control is unnamed').toBe('undo')
    check('page with an undo notice')
    action?.click()
  })
})

/**
 * **THE IMPORT DIALOG, IN EXPLORER ALONE**, for the notice's reason above: it is a modal no workspace switch
 * touches (Plan 7 part 6b spec §10). It is walked open and empty, where both applies are disabled with a reason;
 * after a failing scheme's check with its details open, where `apply adjusted` can act; and with both halves stored,
 * where each `remove` in the now line is named by its half. While it is open the walk is the dialog's alone, and this
 * asserts that rather than trusting it.
 */
describe('every control in Explorer, in the settings menu and the import dialog', () => {
  const open = () => {
    document.querySelector<HTMLButtonElement>('#settings')?.click()
    document.querySelector<HTMLButtonElement>('#import-base16')?.click()
    expect(base16Dialog().matches(':modal'), 'the import dialog did not open').toBe(true)
  }
  const paste = (scheme: string) => {
    const text = base16Dialog().querySelector('textarea') as HTMLTextAreaElement
    text.value = scheme
    text.dispatchEvent(new Event('input'))
    base16Dialog().querySelector<HTMLButtonElement>('button.base16-check')?.click()
  }

  // THE SETTINGS MENU'S CHECKBOX IS AMONG WHAT THE WALK HOLDS: `format when leaving the editor`, named by the label
  // around it.
  it("walks the settings menu's checkbox", () => {
    document.querySelector<HTMLButtonElement>('#settings')?.click()
    const box = document.querySelector<HTMLInputElement>('#format-on-blur') as HTMLInputElement
    expect(controls()).toContain(box)
    expect(nameOf(box)).toBe('format when leaving the editor')
    check('#settings, its checkbox')
    document.querySelector<HTMLElement>('#settings-menu')?.hidePopover()
  })

  it('open and empty, where neither apply can act', () => {
    open()
    const walked = controls()
    expect(walked.map(nameOf)).toEqual(['base16 scheme (YAML)', 'check', 'apply', 'apply adjusted', 'cancel'])
    check('the import dialog, empty')
    base16Dialog().close()
  })

  it("after a failing scheme's check, with its details open", () => {
    open()
    paste(legacyLayout('Ember', EMBER))
    base16Dialog().querySelector<HTMLButtonElement>('.panel[data-panel="base16-details"] button.panel-toggle')?.click()
    expect(controls().map(nameOf)).toEqual([
      'base16 scheme (YAML)',
      'check',
      'details',
      'apply',
      'apply adjusted',
      'cancel',
    ])
    expect(base16Dialog().querySelector<HTMLButtonElement>('button.base16-apply-adjusted')?.disabled).toBe(false)
    check('the import dialog, checked')
    base16Dialog().close()
  })

  // THE DARK HALF IS APPLIED ADJUSTED, SO THE NOW LINE HAS ITS `changes` TOGGLE TOO, walked closed and open.
  it('with both halves stored, each remove named by its half, and an adjusted half’s changes', () => {
    open()
    paste(legacyLayout('Day', DAY))
    base16Dialog().querySelector<HTMLButtonElement>('button.base16-apply')?.click()
    open()
    paste(legacyLayout('Ember', EMBER))
    base16Dialog().querySelector<HTMLButtonElement>('button.base16-apply-adjusted')?.click()
    open()
    const walked = [
      'remove the light palette, Day',
      'remove the dark palette, Ember',
      'changes',
      'base16 scheme (YAML)',
      'check',
      'apply',
      'apply adjusted',
      'cancel',
    ]
    expect(controls().map(nameOf)).toEqual(walked)
    check('the import dialog, with both halves stored')
    base16Dialog()
      .querySelector<HTMLButtonElement>('.panel[data-panel="base16-now-changes"] button.panel-toggle')
      ?.click()
    expect(controls().map(nameOf)).toEqual(walked)
    check('the import dialog, with an adjusted half’s changes open')
    base16Dialog().close()
  })
})

/**
 * THE `views` TOGGLES IN THE HEADER (the view layouts spec §6): this file runs in the runner's 414 px window, where
 * `main.ts` puts the toggles in the workspace menu, and the walks above meet them there with that menu open. This group
 * widens the window to meet them in the header, and **THE TOGGLES ARE ASSERTED TO BE AMONG WHAT WAS WALKED**, since a
 * walk that skipped them would pass as the ones above do.
 */
describe('every control in Explorer, in a window wide enough for the views toggles', () => {
  const toggles = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('#views-shown button')]
  beforeAll(async () => {
    await page.viewport(1280, 896)
  })
  afterAll(async () => {
    for (const b of toggles()) if (b.getAttribute('aria-pressed') === 'false') b.click()
    await page.viewport(414, 896)
  })

  it('walks every toggle, each named by its own word', () => {
    const walked = check('wide: page')
    expect(toggles()).toHaveLength(HEADER_ORDER.length)
    for (const b of toggles()) expect(walked, `the walk skipped the ${b.textContent} toggle`).toContain(b)
    expect(toggles().map(nameOf)).toEqual(HEADER_ORDER.map((kind) => KIND_WORD[kind]))
  })

  // DISABLED BY `aria-disabled` (`app-header.ts`'s `viewToggles`), so the walk holds it to taking the focus too.
  it('walks them with one view left, where the last toggle is disabled and still named', () => {
    for (const b of toggles().slice(1)) if (b.getAttribute('aria-pressed') === 'true') b.click()
    expect(toggles().map((b) => b.getAttribute('aria-disabled'))).toEqual(['true', null, null, null, null])
    const walked = check('wide: one view')
    expect(walked).toContain(toggles()[0])
    expect(nameOf(toggles()[0] as HTMLButtonElement)).toBe('source')
  })
})

/**
 * **WHAT THE WALK LEAVES OUT, HELD WHERE THE PAGE CANNOT SHOW IT** — Plan 7 part 6a spec §6. The app has no hidden
 * input, so nothing on it can say whether `controls()` skips one. One is put on the page for the case and taken off
 * after it. A closed dialog's controls need no case of their own: the import dialog is on the page, closed, for every
 * walk above but its own.
 */
describe('the walk itself', () => {
  it('skips a hidden input', () => {
    const hidden = document.createElement('input')
    hidden.type = 'hidden'
    hidden.id = 'gate-hidden'
    document.body.append(hidden)
    try {
      expect(document.getElementById('gate-hidden')).toBe(hidden)
      expect(controls().map((el) => el.id)).not.toContain('gate-hidden')
    } finally {
      hidden.remove()
    }
  })
})
