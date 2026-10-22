import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { clickWorkspaceItem, host, mounted, SHELL, selectedTab, stateIdle, tabLeaves, until } from './harness'

/**
 * **THE GESTURES THAT CHANGE WHICH VIEWS EXIST, PERFORMED ON THE STAGE.** `stage.test.ts` drives the
 * switch and the tabs; this file drives `✕` and `+ view` while the stage is up, because those two name a
 * leaf through `pane-host.ts`'s `focusPane` and the stage mounts only one host — so a leaf they name may
 * not be on the page at all.
 */

describe('the stage, under the gestures that add and remove views', () => {
  beforeAll(async () => {
    // WIDE ENOUGH FOR ITS ADDS: at the runner's default 414 px a view is 201 px wide, and the app refuses a split or a
    // `+ view` that leaves a view under `MIN_VIEW_PX` (`layout.ts`). The default's 896 px height is kept.
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    const view: EditorView = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(stateIdle, 'the first compile')
  })

  /**
   * Spec §11 is categorical — "Focus never falls to `<body>`" — and names this gesture outright: "closing a
   * view moves focus to the title of the view that becomes `focused`".
   *
   * **THE PRECONDITIONS ARE ASSERTED BECAUSE THEY PICK A CLOSE WHERE TWO LEAVES DIFFER.** `close` names the
   * view before the closed one (`main.ts`'s `neighbourOf`), and the stage mounts the focused view, which falls
   * back to `workspace.ts`'s `defaultFocus` where the named one was not recorded first. On `harness.ts`'s
   * `fourViews()`, closing `lambda-0` names `source`, and the fallback is `asm-0`. Closing `asm-0` instead
   * makes them agree — both are `lambda-0`, the leaf before it and the first one left that is not the source —
   * so a version of this case that picked that view would pass against a stage that mounted the fallback.
   */
  it('does not strand the focus when the shown view is closed', () => {
    clickWorkspaceItem('[data-preset="stage"]')
    expect(tabLeaves(), 'the stage is not showing the four views').toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
    expect(selectedTab(), 'the precondition is that lambda-0 is the shown view').toBe('lambda-0')

    const close = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-close')
    expect(close, 'the shown view offers no ✕ to click').not.toBeNull()
    close?.focus()
    expect(document.activeElement, 'the ✕ did not take the focus').toBe(close)
    close?.click()

    expect(tabLeaves()).toEqual(['source', 'asm-0', 'tm-0'])
    expect(document.activeElement, 'focus fell to <body> when the shown view was closed').not.toBe(document.body)
    // AND IT IS IN THE VIEW THAT BECAME FOCUSED, which is what spec §11 actually promises — not merely
    // somewhere other than `<body>`.
    expect(mounted(), 'the stage mounts a view other than the focused one').toEqual([selectedTab() as string])
    expect(
      host(selectedTab() as string)?.contains(document.activeElement),
      'focus is not inside the view the stage now shows',
    ).toBe(true)
  })

  /**
   * §5: "`+ view` adds the pick beside the focused view … so in Stage the new tab sits after the focused
   * one". The `⋯` menu's split items are removed there, so a `+ view` whose result is invisible would
   * leave the stage with no working way to add a view beside the focused one.
   */
  it('shows the view that + view creates', () => {
    const before = tabLeaves()
    document.querySelector<HTMLButtonElement>('#new-view')?.click()
    const item = document.querySelector<HTMLButtonElement>('#new-view-menu button')
    expect(item, '+ view offered nothing to pick').not.toBeNull()
    item?.click()
    const menu = document.querySelector<HTMLElement>('#new-view-menu')
    if (menu?.matches(':popover-open')) menu.hidePopover()

    expect(tabLeaves().length, '+ view added no tab').toBe(before.length + 1)
    const created = tabLeaves().find((id) => !before.includes(id)) as string
    expect(selectedTab(), 'the created view is not the one the stage shows').toBe(created)
    expect(mounted(), 'the created view is not the host on the page').toEqual([created])
  })
})
