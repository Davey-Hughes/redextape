import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'
import { lambdaSettled } from './lambda-text'

const pick = (sel: string): void => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
  const m = document.querySelector<HTMLElement>('#workspace-menu')
  if (m?.matches(':popover-open')) m.hidePopover()
}
const tabs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('#views [role="tab"]')]
const tab = (leaf: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`) as HTMLElement
const selected = (): string | undefined =>
  document.querySelector<HTMLElement>('#views [role="tab"][aria-selected="true"]')?.dataset.leaf
/** The view hosts on the page — every `[data-leaf]` that is not itself a tab. */
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)

describe('stage', () => {
  /**
   * The layout tree as it stands in tiles, captured before any case enters the stage — the "arrangement"
   * §5 promises back. Captured here rather than in the case that checks it, because by then the stage has
   * been up for several cases and the thing to compare against is gone.
   */
  let treeBeforeStage: unknown

  beforeAll(async () => {
    document.body.innerHTML = SHELL
    const view: EditorView = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
    treeBeforeStage = JSON.parse(localStorage.getItem('redextape.layout') ?? '{}').tree
    expect(treeBeforeStage, 'no stored tree to compare the arrangement against').toBeDefined()
  })

  it('draws one tab per leaf, in leaves() order, over the focused view alone', () => {
    expect(mounted()).toEqual(['source', 'lambda-0', 'tm-0'])
    pick('[data-switch="views"][data-value="stage"]')
    expect(tabs().map((t) => t.dataset.leaf)).toEqual(['source', 'lambda-0', 'tm-0'])
    expect(tabs().map((t) => t.textContent)).toEqual(['source', 'λ · program', 'TM · program'])
    // EXACTLY ONE HOST IS ON THE PAGE; the others are in `pane-host.ts`'s map, off it.
    expect(mounted()).toEqual(['lambda-0'])
  })

  it('marks exactly one tab selected, and that tab names the host it shows', () => {
    const marked = tabs().filter((t) => t.getAttribute('aria-selected') === 'true')
    expect(marked).toHaveLength(1)
    const controls = marked[0]?.getAttribute('aria-controls')
    expect(document.getElementById(controls ?? '')?.dataset.leaf).toBe('lambda-0')
  })

  // §5: arrow keys move with a roving tabindex; Enter or Space selects.
  it('moves between tabs with the arrow keys and selects with Enter, keeping the focus', () => {
    expect(tab('lambda-0').tabIndex).toBe(0)
    expect(tab('tm-0').tabIndex).toBe(-1)
    tab('lambda-0').focus()
    tab('lambda-0').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(document.activeElement).toBe(tab('tm-0'))
    // **THE TAB STOP MOVES WITH THE FOCUS — a roving `tabindex` that does not rove is not one.** Without
    // this, `Tab` out of the strip and `Shift+Tab` back returns to the SELECTED tab rather than the one
    // the user arrowed to. Selection is manual here, so the stop follows focus, not selection.
    expect(tab('tm-0').tabIndex, 'the arrowed-to tab is not the tab stop').toBe(0)
    expect(tab('lambda-0').tabIndex, 'the tab stop was left behind on the selected tab').toBe(-1)
    // MOVING IS NOT SELECTING — manual activation, which is what §5's "Enter or Space selects" means.
    expect(selected()).toBe('lambda-0')
    ;(document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    )
    expect(selected()).toBe('tm-0')
    expect(mounted()).toEqual(['tm-0'])
    // THE REBUILD DOES NOT DROP THE FOCUS: `renderStage` restores it by `data-leaf`, as `renderLayout`
    // restores a divider by `data-path`/`data-index`.
    expect(document.activeElement).toBe(tab('tm-0'))
  })

  // §5: "In Stage the ⋯ menu's split items are removed" (umbrella §4 rule 4 — they can never apply
  // there, so they go rather than being disabled).
  it('removes the split items when the stage is chosen', () => {
    pick('[data-switch="views"][data-value="tiles"]')
    const more = document.querySelector<HTMLButtonElement>('[data-leaf="tm-0"] button.view-more') as HTMLButtonElement
    more.click()
    expect(
      document.querySelector('[data-leaf="tm-0"] button.view-split[data-dir="row"]'),
      'tiles offers no split to remove, so this proves nothing',
    ).not.toBeNull()
    pick('[data-switch="views"][data-value="stage"]')
    // **THE VIEW HAS TO BE ON THE PAGE FOR ITS ABSENT SPLIT ITEMS TO MEAN ANYTHING.** In Stage only the
    // focused leaf's host is in the document, so this selector returns null for a view the stage merely
    // is not showing — a reason that has nothing to do with split items.
    expect(mounted(), 'tm-0 is not the shown view, so its missing split items prove nothing').toEqual(['tm-0'])
    expect(document.querySelector('[data-leaf="tm-0"] button.view-split')).toBeNull()
    const menu = document.querySelector<HTMLElement>('[data-leaf="tm-0"] .view-menu')
    if (menu?.matches(':popover-open')) menu.hidePopover()
  })

  /**
   * **SPEC §11's FOURTH RULE AT THE INSTANCE THE SPEC NAMES BY HAND, IN THE TWO HALVES
   * `extend-focus-probe.test.ts` ESTABLISHED** — and the answer is the same one that file reached about
   * the continue button.
   *
   * HALF ONE — IS THE MECHANISM REAL? Removing a focused menu item strands the focus on `<body>`.
   */
  it('removing a focused split item would strand the focus on body', () => {
    pick('[data-switch="views"][data-value="tiles"]')
    const more = document.querySelector<HTMLButtonElement>('[data-leaf="tm-0"] button.view-more') as HTMLButtonElement
    more.click()
    const split = document.querySelector<HTMLButtonElement>(
      '[data-leaf="tm-0"] button.view-split[data-dir="row"]',
    ) as HTMLButtonElement
    split.focus()
    expect(document.activeElement).toBe(split)
    const parent = split.parentElement as HTMLElement
    const next = split.nextElementSibling
    split.remove()
    expect(document.activeElement).toBe(document.body)
    parent.insertBefore(split, next)
    const menu = document.querySelector<HTMLElement>('[data-leaf="tm-0"] .view-menu')
    if (menu?.matches(':popover-open')) menu.hidePopover()
  })

  /**
   * HALF TWO — CAN THE GESTURE REACH IT? **No.** The only way to choose Stage is the workspace menu, and
   * opening a menu is itself a focus-bearing interaction somewhere else — so at the instant the split
   * items are removed, the focus is on the menu item the user just clicked, never on a split item.
   *
   * The `handOff` in `viewMenu`'s `sync` therefore stays as defence against a future caller that chooses
   * a preset without a menu — a share link (part 6), a keyboard shortcut (part 3) — and its sabotage does
   * not fire. **This is the third of part 2b's three instances of §11's fourth rule to come out this
   * way**, which is a fact about the rule rather than about any one of them.
   */
  it('leaves the focus on the gesture that chose the stage, not on a removed split item', () => {
    pick('[data-switch="views"][data-value="tiles"]')
    const more = document.querySelector<HTMLButtonElement>('[data-leaf="tm-0"] button.view-more') as HTMLButtonElement
    more.click()
    const split = document.querySelector<HTMLButtonElement>(
      '[data-leaf="tm-0"] button.view-split[data-dir="row"]',
    ) as HTMLButtonElement
    split.focus()
    expect(document.activeElement).toBe(split)
    pick('[data-switch="views"][data-value="stage"]')
    expect(mounted(), 'tm-0 is not the shown view, so its missing split items prove nothing').toEqual(['tm-0'])
    expect(document.querySelector('[data-leaf="tm-0"] button.view-split'), 'nothing was removed').toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).not.toBe(split)
    const menu = document.querySelector<HTMLElement>('[data-leaf="tm-0"] .view-menu')
    if (menu?.matches(':popover-open')) menu.hidePopover()
  })

  // §5: "Flipping back to `tiles` shows the arrangement the user left."
  it('gives back the arrangement when the switch goes to tiles', () => {
    pick('[data-switch="views"][data-value="tiles"]')
    expect(tabs()).toHaveLength(0)
    expect(mounted()).toEqual(['source', 'lambda-0', 'tm-0'])
    expect(document.querySelectorAll('#views .layout-divider').length).toBeGreaterThan(0)
    // **THE SIZES, NOT JUST THE LEAVES.** `renderStage` writes nothing to the tree, which is what makes
    // the arrangement survive — but a version that renormalised `sizes` on the way through would pass a
    // leaf-list assertion unchanged. The stored tree is the arrangement.
    expect(JSON.parse(localStorage.getItem('redextape.layout') ?? '{}').tree).toEqual(treeBeforeStage)
  })

  /**
   * §5: "`draw()` skips any pane whose host is not connected, and selecting a tab calls `draw()` once so
   * the shown view is current."
   *
   * **THIS DRIVES THE `steps` SWITCH, AND THAT IS THE WHOLE FINDING.** Two earlier versions of this case
   * could not fail. Playing the visible view and comparing the hidden one's markup cannot: with the skip
   * removed, `draw()` does repaint the hidden pane and the markup comes out BYTE-IDENTICAL, because the
   * hidden leg is not the one playing and the pane's own rendered-key guards make the repaint a no-op.
   * Driving a recompile cannot either: `replies.ts` paints panes directly when a reply lands and that path
   * has no connection check, so the hidden view changes with or without the skip.
   *
   * `setStepsShown` is the one thing that reaches a pane ONLY through `draw.ts`. So flipping the `steps`
   * switch while a view is hidden produces a change that only `draw()` can make — and both halves below
   * discriminate: the first fails if the skip is removed, the second if the `draw()` at the end of a tab
   * selection is.
   */
  it('skips a hidden view, and brings it up to date when its tab is selected', () => {
    pick('[data-switch="views"][data-value="tiles"]')
    // THE HOST REFERENCE IS TAKEN IN TILES: a detached host is not reachable by `document.querySelector`,
    // and `[data-leaf="tm-0"]` would match the tm-0 TAB instead, which is connected.
    const host = document.querySelector<HTMLElement>('[data-leaf="tm-0"]') as HTMLElement
    expect(host.getAttribute('role'), 'that is a tab, not a host').not.toBe('tab')
    expect(host.querySelector('.view-steps .controls'), 'the TM view has no step controls to lose').not.toBeNull()

    pick('[data-switch="views"][data-value="stage"]')
    tab('lambda-0').click()
    expect(host.isConnected, 'the TM host is on the page, so this proves nothing').toBe(false)

    // HALF ONE — `draw()` SKIPPED IT. The switch is now `bar`, so every view that `draw()` reached has had
    // its step slot taken away; this one is off the page and still has its own.
    pick('[data-switch="steps"][data-value="bar"]')
    expect(
      host.querySelector('.view-steps .controls'),
      'the hidden view was painted: its step controls were taken away while it was off the page',
    ).not.toBeNull()

    // HALF TWO — SELECTING ITS TAB BRINGS IT CURRENT, in one `draw()`.
    tab('tm-0').click()
    expect(host.isConnected).toBe(true)
    expect(
      host.querySelector('.view-steps .controls'),
      'selecting the tab did not bring the view up to date',
    ).toBeNull()

    pick('[data-preset="explorer"]')
  })

  /**
   * THE λ HALF OF THE LINK STATUS COMES FROM THE VIEW THAT DREW THE TREE (spec §5.4), AND A VIEW OFF THE
   * PAGE DREW NONE. `draw()` skips it, so its pin and its tree are whatever it last drew. Asked anyway, it
   * answered for the construct pinned before: with `40` pinned while it was shown, a later `x + 2` read "no
   * node", though the view marks `x + 2` at this step as soon as it is shown again.
   *
   * With no λ view on the page the λ clause says nothing. With two λ views the one the stage shows answers,
   * not the one last clicked into: selecting a tab records the focused leaf and marks no pane active.
   */
  it('takes the λ half of the link status from the λ view on the page, and from none when none is', async () => {
    const view: EditorView = await (await import('../../src/main')).ready
    const src = view.state.doc.toString()
    expect(src).toBe('let x = 40; x + 2')
    const linkStatus = () => document.querySelector('#link-status')?.textContent ?? ''
    const linkedSource = () => document.querySelector('.cm-editor .linked')?.textContent ?? ''
    const linkAt = (pos: number): void => {
      view.dispatch({ selection: { anchor: pos } })
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: "'", ctrlKey: true, cancelable: true }))
    }
    const stepText = () => document.querySelector('[data-leaf="lambda-0"] .step')?.textContent ?? ''
    const control = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')]
        .find((b) => b.textContent === label)
        ?.click()
    const NO_NODE = 'this construct has no node in the λ term at this step'

    pick('[data-switch="views"][data-value="stage"]')
    pick('[data-switch="steps"][data-value="view"]')
    tab('lambda-0').click()
    expect(mounted()).toEqual(['lambda-0'])
    await until(() => stepText() !== '' && !stepText().includes('not run'), 'the λ leg to run')
    control('↺')
    control('▶')
    expect(stepText()).toContain('step 1')
    await lambdaSettled()

    // `40` HAS NO NODE AT STEP 1, and the view on the page says so; off the page, nothing is said.
    tab('source').click()
    expect(mounted()).toEqual(['source'])
    linkAt(src.indexOf('40'))
    await until(() => linkedSource() === '40', '40 to be linked')
    expect(linkStatus(), 'no λ view is on the page to say anything about').not.toContain('λ')
    tab('lambda-0').click()
    await lambdaSettled()
    expect(linkStatus()).toContain(NO_NODE)

    // `x + 2` HAS ONE, and the hidden view must not answer for the `40` it last drew.
    tab('source').click()
    linkAt(src.indexOf('+'))
    await until(() => linkedSource() === 'x + 2', 'x + 2 to be linked')
    expect(linkStatus(), 'the hidden λ view answered for the pin it last drew').not.toContain('λ')
    tab('lambda-0').click()
    await until(() => document.querySelector('[data-leaf="lambda-0"] .term .is-linked') !== null, 'x + 2 marked')
    expect(linkStatus()).not.toContain('λ')

    // TWO λ VIEWS: `+ view` shows the one it creates, and the focus moving into its term marks it active;
    // then the stage goes back to `lambda-0`, and the active view is the one off the page.
    const binding = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] button.view-title')?.dataset.binding
    expect(binding, 'lambda-0 names no binding to duplicate').toBeDefined()
    const before = tabs().map((t) => t.dataset.leaf)
    document.querySelector<HTMLButtonElement>('#new-view')?.click()
    const item = document.querySelector<HTMLButtonElement>(`#new-view-menu button[data-binding="${binding}"]`)
    expect(item, '+ view offers no second view of the program’s λ leg').not.toBeNull()
    item?.click()
    const created = tabs()
      .map((t) => t.dataset.leaf)
      .find((id) => !before.includes(id))
    expect(created, '+ view added no tab').toBeDefined()
    expect(mounted()).toEqual([created])
    document.querySelector<HTMLElement>(`[data-leaf="${created}"] .term`)?.focus()
    expect(
      document.querySelector(`[data-leaf="${created}"]:not([role="tab"])`)?.contains(document.activeElement),
      'the focus is not in the created view, so nothing marked it active',
    ).toBe(true)

    tab('source').click()
    linkAt(src.indexOf('40'))
    await until(() => linkedSource() === '40', '40 to be linked again')
    tab('lambda-0').click()
    expect(mounted()).toEqual(['lambda-0'])
    await lambdaSettled()
    expect(linkStatus(), 'the λ view on the page did not answer').toContain(NO_NODE)

    pick('[data-preset="explorer"]')
  })
})
