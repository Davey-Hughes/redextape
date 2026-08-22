import { beforeEach, describe, expect, it } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneChoice, PaneEvents } from '../../src/pane-chrome'
import { layoutControls } from '../../src/pane-chrome'
import type { Leg } from '../../src/protocol'
import type { Binding, PaneOption } from '../../src/sessions'
import { TmPane } from '../../src/tm-pane'

/**
 * THE LAYOUT CONTROLS, AND THE ABSENCES THAT ARE THE DESIGN.
 *
 * Both "cannot" cases are asserted as REMOVAL rather than as `disabled`, per the accessibility list's
 * item 1 — a control that provably cannot work should not be offered. The source pane has no split
 * because there is one editor to duplicate; the last leaf has no close because an empty tree has no
 * rendering.
 */

const noop = () => {}
const events = (over: Partial<PaneEvents> = {}): PaneEvents => ({
  back: noop,
  forward: noop,
  play: noop,
  restart: noop,
  extend: noop,
  rebind: noop,
  ...over,
})

let parent: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  parent = document.createElement('div')
  document.body.append(parent)
})

const buttons = () => [...parent.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))

/**
 * The pairs and the pane's own binding every test below builds a menu from — declared HERE, above the
 * first `describe`, rather than beside the picker's own tests, because both groups need them now: a
 * caller that supplies no `choices` gets NO split control at all (`layoutControls`'s own doc), so the
 * ordering and removal claims in the first group have to be made against a real menu.
 */
const OPTIONS: readonly PaneOption[] = [
  { leg: 'lambda', id: 'src', label: 'source' },
  { leg: 'lambda', id: 'scr', label: 'scratch' },
  { leg: 'tm', id: 'src', label: 'source' },
]
const CURRENT: Binding<Leg> = { leg: 'lambda', session: 'src' }
const CHOICES = () => ({ options: OPTIONS, sourceAvailable: false, current: CURRENT })

const splitRowButton = () => parent.querySelector<HTMLButtonElement>('button[aria-label="split left and right"]')
const splitColumnButton = () => parent.querySelector<HTMLButtonElement>('button[aria-label="split top and bottom"]')

/**
 * Open a split control's menu and click its first entry — the pane's own pair, labelled `(same)`.
 *
 * THE MENU IS REACHED THROUGH `aria-controls`. A pane has two pickers and each keeps the items it was
 * last opened with, so a query for `.pane-picker button` would collect both menus' entries and could
 * click one inside a popover that is not open. The invoker names exactly one menu, which is the
 * relationship `splitControl` builds it for.
 */
const chooseFirst = (button: HTMLButtonElement | null) => {
  button?.click()
  const menu = document.getElementById(button?.getAttribute('aria-controls') ?? '')
  menu?.querySelector<HTMLButtonElement>('button')?.click()
}

describe('layoutControls', () => {
  it('offers split and close when both are possible', () => {
    layoutControls(parent, events(), CHOICES).update(true, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom', 'close this pane'])
  })

  /**
   * THE SOURCE PANE'S SHAPE, AND THE OTHER HALF OF `PaneEvents.splitRow` TAKING A REQUIRED `PaneChoice`.
   * A split reports what to create; a control with no menu has nothing to report, so a caller supplying
   * no `choices` gets no split control rather than a button that fires an argument it cannot produce —
   * `main.ts`'s source pane is that caller, and it has always passed `canSplit: false` besides. This
   * asserts `canSplit: true` deliberately: the absence must come from the missing menu, not from the
   * flag, or the claim would hold for a reason this test does not name.
   */
  it('builds no split control at all for a caller that supplies no choices', () => {
    layoutControls(parent, events()).update(true, true)
    expect(buttons()).toEqual(['close this pane'])
    expect(parent.querySelectorAll('.pane-picker').length).toBe(0)
  })

  it('REMOVES the split controls rather than disabling them when splitting is impossible', () => {
    layoutControls(parent, events(), CHOICES).update(true, false)
    expect(buttons()).toEqual(['close this pane'])
    expect(parent.querySelectorAll('button[disabled]').length).toBe(0)
  })

  it('REMOVES the close control rather than disabling it when this is the last leaf', () => {
    layoutControls(parent, events(), CHOICES).update(false, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom'])
    expect(parent.querySelectorAll('button[disabled]').length).toBe(0)
  })

  /**
   * ONE REPORT PER GESTURE, WITH THE SPLITS DRIVEN THROUGH THEIR MENUS. This test used to click every
   * button in `parent` in document order, which was the whole gesture while a split was one click; the
   * claim is unchanged and only the second click is new. `close` is still a single click, which is what
   * keeps the three in one test.
   *
   * **IT NO LONGER SAYS ANYTHING ABOUT THE STRIP'S ORDER, AND THAT CLAUSE WAS DELETED RATHER THAN
   * REPHRASED — MINOR FINDING.** It read "the ordering of the reports is the ordering of the strip",
   * which was true of the old body: it clicked `querySelectorAll('button')` in DOCUMENT order, so the
   * sequence below was the strip's own. This body clicks in an order the test chooses, so `toEqual`
   * pins that each gesture fires once and that each control is wired to the handler it names — nothing
   * about where the controls sit. The tests around this one are what hold the strip's order.
   */
  it('reports each gesture exactly once per click', () => {
    const seen: string[] = []
    const c = layoutControls(
      parent,
      events({
        splitRow: () => seen.push('row'),
        splitColumn: () => seen.push('column'),
        close: () => seen.push('close'),
      }),
      CHOICES,
    )
    c.update(true, true)
    chooseFirst(splitRowButton())
    chooseFirst(splitColumnButton())
    parent.querySelector<HTMLButtonElement>('button[aria-label="close this pane"]')?.click()
    expect(seen).toEqual(['row', 'column', 'close'])
  })

  it('does not rewire its handlers when update is called again', () => {
    const seen: string[] = []
    const c = layoutControls(parent, events({ close: () => seen.push('close') }), CHOICES)
    c.update(true, true)
    c.update(true, true)
    c.update(true, true)
    const close = parent.querySelector('button[aria-label="close this pane"]') as HTMLButtonElement
    close.click()
    expect(seen).toEqual(['close'])
  })

  /**
   * FINDING 1. `parent.append(...splitNodes)` MOVES existing nodes to the end of `parent`
   * rather than duplicating them. Every test above this one makes a SINGLE transition from a fresh
   * instance, so `close` was never mounted when the splits were (re)appended and this bug never had
   * anything to shove out of place. This is the sequence that does: split and close both show, splitting
   * turns off, splitting turns back on — and without the re-append in `layoutControls`, `close` (mounted
   * on the first `update` and never removed) is left sitting in front of the two split buttons instead
   * of after them.
   */
  it('keeps split-row, split-column, close in order across a canSplit toggle', () => {
    const c = layoutControls(parent, events(), CHOICES)
    c.update(true, true)
    c.update(true, false)
    c.update(true, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom', 'close this pane'])
  })

  /**
   * FINDING 3. Every `it` above either never shows a control (asserting absence of something that was
   * never added) or shows one and leaves it — `shownSplit`/`shownClose` both default to `false`, so a
   * fresh instance's `.remove()` branch never runs. These two mount first and then drive the SAME
   * transition a fresh instance would make for "impossible", so the `.remove()` calls are the only way
   * the assertion can pass.
   */
  it('removes the split controls, once mounted, when splitting stops being possible', () => {
    const c = layoutControls(parent, events(), CHOICES)
    c.update(true, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom', 'close this pane'])
    c.update(true, false)
    expect(buttons()).toEqual(['close this pane'])
  })

  it('removes the close control, once mounted, when this becomes the last leaf', () => {
    const c = layoutControls(parent, events(), CHOICES)
    c.update(true, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom', 'close this pane'])
    c.update(false, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom'])
  })
})

/**
 * THE SPLIT PICKER — the menu the two split controls open.
 *
 * DRIVEN THROUGH `layoutControls` DIRECTLY RATHER THAN THROUGH A MOUNTED APP, and the reason is a
 * boundary rather than a convenience: these are claims about the CONTROL — a click opens rather than
 * splits, the list offers the pane's own pair first and every other pair after it, `source` appears
 * exactly when the caller says the tree has no source leaf, and the menu lands against its own button.
 * What the app does with a pick is `pane-picker.test.ts`'s subject, driven through a mounted `main()`
 * because a created pane, its session and the layout around it are facts no fixture here holds.
 *
 * `sourceAvailable` IS A `let` THE FIXTURE CLOSES OVER, WHICH IS THE POINT OF `choices` BEING A THUNK.
 * The menu is built on OPEN (`splitControl`'s own doc), so a value that changes between two opens has
 * to show up in the second one without anything calling `update` in between — that is the staleness
 * the per-frame path would otherwise have to be swept for, asserted rather than argued.
 */

// EXACT EQUALITY AGAINST `'source'`, NOT `includes('source')`. The source SESSION is labelled `source`
// too (`main.ts`'s `sessions.add`), so every pair it contributes reads `λ · source` / `TM · source` —
// a substring test for the source PANE would be satisfied by the pane's own binding and could never
// fail. The one entry that is not a `(leg, session)` pair is the one with no leg in its text.
const menuLabels = () => [...parent.querySelectorAll<HTMLElement>('.pane-picker button')].map((b) => b.textContent)

describe('layoutControls: the split picker', () => {
  it('opens a menu of pairs rather than splitting immediately', () => {
    const fired: PaneChoice[] = []
    const c = layoutControls(parent, events({ splitRow: (choice) => fired.push(choice) }), () => ({
      options: OPTIONS,
      sourceAvailable: false,
      current: CURRENT,
    }))
    c.update(true, true)
    splitRowButton()?.click()

    // The click opens, it does not split.
    expect(fired).toEqual([])
    const menu = parent.querySelector<HTMLElement>('.pane-picker')
    expect(menu?.matches(':popover-open')).toBe(true)
    // The pane's own pair is first, labelled as the duplicate case; the rest follow in `pairs()` order.
    expect(menuLabels()).toEqual(['λ · source (same)', 'λ · scratch', 'TM · source'])
  })

  it('offers source only when the caller says no source leaf is in the tree', () => {
    let sourceAvailable = false
    const c = layoutControls(parent, events(), () => ({ options: OPTIONS, sourceAvailable, current: CURRENT }))
    c.update(true, true)

    splitRowButton()?.click()
    expect(menuLabels().includes('source')).toBe(false)
    parent.querySelector<HTMLElement>('.pane-picker')?.hidePopover()

    sourceAvailable = true
    splitRowButton()?.click()
    expect(menuLabels().includes('source')).toBe(true)
  })

  it('reports the chosen pair and dismisses itself, once per click', () => {
    const fired: PaneChoice[] = []
    const c = layoutControls(parent, events({ splitColumn: (choice) => fired.push(choice) }), () => ({
      options: OPTIONS,
      sourceAvailable: true,
      current: CURRENT,
    }))
    c.update(true, true)
    parent.querySelector<HTMLButtonElement>('button[aria-label="split top and bottom"]')?.click()

    const items = [...parent.querySelectorAll<HTMLButtonElement>('.pane-picker button')]
    items.find((b) => b.textContent === 'TM · source')?.click()
    expect(fired).toEqual([{ kind: 'tm', session: 'src' }])
    expect(parent.querySelector<HTMLElement>('.pane-picker')?.matches(':popover-open')).toBe(false)
  })

  /**
   * THE KEYBOARD PATH, ASSERTED RATHER THAN ARGUED. Splitting used to be one click on a button; it is
   * now a button that opens a menu, and a menu a keyboard user cannot reach would turn a working
   * control into an inoperable one — the accessibility list's item 1 in its worst form, since this is a
   * CREATION gesture with no other route to it. `aria-expanded` is the state, and focus landing on the
   * first item is what makes the second gesture reachable without a pointer.
   */
  it('names its expanded state and puts focus on the first item', () => {
    const c = layoutControls(parent, events(), () => ({ options: OPTIONS, sourceAvailable: false, current: CURRENT }))
    c.update(true, true)
    const b = splitRowButton()
    expect(b?.getAttribute('aria-haspopup')).toBe('menu')
    expect(b?.getAttribute('aria-expanded')).toBe('false')

    b?.click()
    expect(b?.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement?.textContent).toBe('λ · source (same)')

    parent.querySelector<HTMLElement>('.pane-picker')?.hidePopover()
    expect(b?.getAttribute('aria-expanded')).toBe('false')
  })

  /**
   * FINDING 1's SEQUENCE, RUN AGAINST THE PICKER PATH. `canSplit` now adds and removes FOUR nodes per
   * toggle rather than two — each split button and the popover beside it — so the re-append of `close`
   * that keeps the order right has twice as much to step over, and a menu left behind by a `remove()`
   * loop that only knew about buttons would sit in the strip as an empty element forever.
   */
  it('keeps split-row, split-column, close in order across a canSplit toggle, menus included', () => {
    const c = layoutControls(parent, events(), () => ({ options: OPTIONS, sourceAvailable: false, current: CURRENT }))
    c.update(true, true)
    c.update(true, false)
    expect(parent.querySelectorAll('.pane-picker').length).toBe(0)
    c.update(true, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom', 'close this pane'])
    expect(parent.querySelectorAll('.pane-picker').length).toBe(2)
  })
})

/**
 * WHERE THE MENU LANDS — geometry, because the first version of this control got it wrong in a way no
 * behavioural test could see.
 *
 * A `popover` IS `position: fixed; inset: 0` IN THE UA STYLESHEET, so a menu that says nothing about its
 * own placement does not appear near the control that opened it: with `margin: 0` overriding the UA's
 * centring `margin: auto`, `left: 0`/`right: 0` against a `fit-content` width is over-constrained,
 * `right` is dropped, and the menu pins to the TOP-LEFT CORNER OF THE VIEWPORT — on top of the pane
 * chrome, and in the general case on top of a different pane entirely. Every test above passed against
 * that, because every one of them asks what the menu CONTAINS. The describe below is the one that asks
 * WHERE it is, and it is the whole record of that finding: the before/after screenshot pair it was
 * originally evidenced by lived in an untracked working note, so no clone ever had it and it no longer
 * exists. That is not a loss — a screenshot goes stale silently and this re-measures on every run.
 *
 * THESE ARE REAL MEASUREMENTS, NOT A PROXY FOR ONE. `tests/browser/setup.ts` loads `style.css` into the
 * tester page for exactly this reason (its own doc: the state table's `max-height` is load-bearing
 * geometry), so `getBoundingClientRect` here reads the rules the app ships rather than UA defaults.
 *
 * THE FIXTURE POSITIONS `parent` AWAY FROM THE ORIGIN, which is the whole point: at `left: 0; top: 0` a
 * correctly-anchored menu and a viewport-pinned one would sit in the same place and the assertion would
 * pass for the wrong reason.
 */
const rect = (el: Element | null | undefined) => (el ?? parent).getBoundingClientRect()
const pickerAt = (x: number, y: number) => {
  parent.style.position = 'absolute'
  parent.style.left = `${x}px`
  parent.style.top = `${y}px`
  const c = layoutControls(parent, events(), () => ({ options: OPTIONS, sourceAvailable: false, current: CURRENT }))
  c.update(true, true)
}

describe('layoutControls: where the split picker opens', () => {
  it('opens against the button that opened it, not at the viewport origin', () => {
    pickerAt(200, 150)
    const b = splitRowButton()
    b?.click()
    const menu = rect(parent.querySelector('.pane-picker'))
    const button = rect(b)

    // Directly below its own button, and sharing its leading edge.
    expect(menu.top).toBeGreaterThanOrEqual(button.bottom - 1)
    expect(Math.abs(menu.left - button.left)).toBeLessThan(2)
    // Which is nowhere near the corner the unanchored version pinned itself to.
    expect(menu.left).toBeGreaterThan(100)
    expect(menu.top).toBeGreaterThan(100)
  })

  /**
   * THE ANCHOR IS THE BUTTON, NOT THE PANE — the requirement that rules out anchoring the two menus to
   * one shared element. `split →` and `split ↓` sit side by side, so a menu anchored to their container
   * would put both in the same place and the second would silently cover the first.
   *
   * IT ASKS WHICH EDGE THE MENU SHARES, NOT WHETHER ITS LEFT EDGE MATCHES, AND THAT IS A FINDING RATHER
   * THAN A LOOSENING. The tester page is narrow (Vitest's default browser viewport, a few hundred
   * pixels), and the SECOND control sits far enough along the strip that a 12rem menu opening rightward
   * from it would overflow — so `flip-inline` fires and aligns the menu's TRAILING edge with the
   * button's instead. Asserting `left === left` measured that as a 167px miss on the first run. The
   * claim that holds under both tactics is the one the requirement actually makes: the menu is against
   * its own button, and the two menus are not in the same place. This test therefore covers the
   * inline-edge fallback as well, which is why there is no fourth test for it.
   */
  it('gives each split control its own place, since each anchors to its own button', () => {
    pickerAt(200, 150)
    const row = splitRowButton()
    const column = parent.querySelector<HTMLButtonElement>('button[aria-label="split top and bottom"]')

    row?.click()
    const rowMenu = rect(parent.querySelector('.pane-picker'))
    parent.querySelector<HTMLElement>('.pane-picker')?.hidePopover()

    column?.click()
    const columnMenu = rect(parent.querySelectorAll('.pane-picker')[1])

    const sharesEdge = (menu: DOMRect, button: DOMRect) =>
      Math.abs(menu.left - button.left) < 2 || Math.abs(menu.right - button.right) < 2
    expect(sharesEdge(rowMenu, rect(row))).toBe(true)
    expect(sharesEdge(columnMenu, rect(column))).toBe(true)
    // Two controls, two places — the failure a shared anchor would produce.
    expect(Math.abs(columnMenu.left - rowMenu.left)).toBeGreaterThan(2)
    // And both on screen, which is what the fallback that fired here is for.
    expect(columnMenu.left).toBeGreaterThanOrEqual(0)
    expect(columnMenu.right).toBeLessThanOrEqual(window.innerWidth)
  })

  /**
   * THE EDGE CASE THE FALLBACK EXISTS FOR. A pane at the bottom of the window has no room below its
   * control strip, and a menu that only ever opens downward would run off the screen with no way to
   * scroll to it — a popover is in the top layer, so the document's own scrollbars do not reach it.
   * `flip-block` is the fallback that fires here: the menu opens ABOVE the button instead.
   */
  it('flips above the button rather than off-screen at the viewport bottom edge', () => {
    pickerAt(200, window.innerHeight - 30)
    const b = splitRowButton()
    b?.click()
    const menu = rect(parent.querySelector('.pane-picker'))

    expect(menu.bottom).toBeLessThanOrEqual(rect(b).top + 1)
    expect(menu.top).toBeGreaterThanOrEqual(0)
    expect(menu.bottom).toBeLessThanOrEqual(window.innerHeight)
    // STILL ITS OWN BUTTON'S MENU AFTER THE FLIP, and this line is what stops the test passing
    // vacuously: the unanchored version was already ABOVE a button sitting near the bottom of the
    // window — it was above everything, at the origin — so only the leading edge tells the two apart.
    expect(Math.abs(menu.left - rect(b).left)).toBeLessThan(2)
  })
})

/**
 * FINDING 2. `LambdaPane.setLayoutControls` and `TmPane.setLayoutControls` are the only call sites
 * `layoutControls` has outside this file's direct construction above, and neither pane's own test
 * suite reached them. Constructed the way `tests/browser/binding-selector.test.ts` and
 * `tests/browser/detached-badge.test.ts` construct a real pane — a bare host element and a `PaneEvents`
 * with no gesture wired — because the assertion is about the CONTROLS' presence in THAT pane's DOM, not
 * about what a click does; `layoutControls`'s own tests above already cover the click and the ordering.
 */
const paneHost = () => {
  const el = document.createElement('section')
  el.className = 'pane'
  document.body.append(el)
  return el
}

const layoutButtons = (pane: HTMLElement) =>
  [...pane.querySelectorAll('button.layout-control')].map((b) => b.getAttribute('aria-label'))

/**
 * The choices `draw()` pushes on every recorded frame, as this tier's fixture — `CHOICES()`'s value,
 * since a pane takes the list itself rather than a thunk over it (`PaneView.setLayoutControls`: the list
 * rides the call that mounts the control, and the pane is what holds it for its menus to read on open).
 */
const PUSHED = CHOICES()

describe('LambdaPane.setLayoutControls', () => {
  it('adds and removes the split and close controls on a real pane', () => {
    const el = paneHost()
    const pane = new LambdaPane(el, events())
    expect(layoutButtons(el)).toEqual([])

    pane.setLayoutControls(true, true, PUSHED)
    expect(layoutButtons(el)).toEqual(['split left and right', 'split top and bottom', 'close this pane'])

    pane.setLayoutControls(false, false, PUSHED)
    expect(layoutButtons(el)).toEqual([])
  })

  /**
   * THE PUSHED LIST REACHES THE PANE'S OWN MENU, which is the half of the wiring neither the control's
   * tests above nor `pane-picker.test.ts`'s app-level ones cover: those drive `layoutControls` with a
   * fixture thunk, and those drive a mounted app where `draw()` supplies the list. This is the pane
   * holding what it was handed and its menu reading it back — the field and the thunk, asserted.
   */
  it('offers what the last push named, in its own menu', () => {
    const el = paneHost()
    const pane = new LambdaPane(el, events())
    pane.setLayoutControls(true, true, PUSHED)

    el.querySelector<HTMLButtonElement>('button[aria-label="split left and right"]')?.click()
    expect([...el.querySelectorAll<HTMLElement>('.pane-picker button')].map((b) => b.textContent)).toEqual([
      'λ · source (same)',
      'λ · scratch',
      'TM · source',
    ])
  })
})

describe('TmPane.setLayoutControls', () => {
  it('adds and removes the split and close controls on a real pane', () => {
    const el = paneHost()
    const pane = new TmPane(el, events())
    expect(layoutButtons(el)).toEqual([])

    pane.setLayoutControls(true, true, PUSHED)
    expect(layoutButtons(el)).toEqual(['split left and right', 'split top and bottom', 'close this pane'])

    pane.setLayoutControls(false, false, PUSHED)
    expect(layoutButtons(el)).toEqual([])
  })
})
