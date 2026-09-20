import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

/**
 * **THE GESTURES THAT CHANGE WHICH VIEWS EXIST, PERFORMED ON THE STAGE.** `stage.test.ts` drives the
 * switch and the tabs; this file drives `✕` and `+ view` while the stage is up, because those two name a
 * leaf through `pane-host.ts`'s `focusPane` and the stage mounts only one host — so a leaf they name may
 * not be on the page at all.
 */

const pick = (sel: string): void => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
  const m = document.querySelector<HTMLElement>('#workspace-menu')
  if (m?.matches(':popover-open')) m.hidePopover()
}
const tabs = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [role="tab"]')].map((t) => t.dataset.leaf as string)
const shown = (): string | undefined =>
  document.querySelector<HTMLElement>('#views [role="tab"][aria-selected="true"]')?.dataset.leaf
/**
 * A view's HOST, never its tab.
 *
 * **`[data-leaf="x"]` ALONE MATCHES THE TAB FIRST.** A stage tab carries `data-leaf` too and the tab strip
 * precedes the host in document order, so `document.querySelector` returns the tab — which contains no
 * controls, so a `contains(document.activeElement)` against it reads false no matter where the focus is.
 * Caught by this file's own first run, against a fix that was already working.
 */
const host = (leaf: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${leaf}"]:not([role="tab"])`)

/** The view hosts actually in the document — every `[data-leaf]` under `#views` that is not a tab. */
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)

describe('the stage, under the gestures that add and remove views', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    const view: EditorView = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  })

  /**
   * Spec §11 is categorical — "Focus never falls to `<body>`" — and names this gesture outright: "closing a
   * view moves focus to the title of the view that becomes `focused`".
   *
   * **THE DEFAULT ARRANGEMENT IS THE ONE THAT BREAKS IT, WHICH IS WHY THE PRECONDITIONS ARE ASSERTED.**
   * `close` targets the neighbour that GREW and the stage mounts the view that becomes FOCUSED, and on
   * `defaultLayout()` those are two different leaves: closing `lambda-0` grows `source` and focuses
   * `tm-0`. Closing `tm-0` instead makes them agree, so a version of this case that picked the other view
   * would pass against the same bug.
   */
  it('does not strand the focus when the shown view is closed', () => {
    pick('[data-preset="stage"]')
    expect(tabs(), 'the stage is not showing the default three views').toEqual(['source', 'lambda-0', 'tm-0'])
    expect(shown(), 'the precondition is that lambda-0 is the shown view').toBe('lambda-0')

    const close = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-close')
    expect(close, 'the shown view offers no ✕ to click').not.toBeNull()
    close?.focus()
    expect(document.activeElement, 'the ✕ did not take the focus').toBe(close)
    close?.click()

    expect(tabs()).toEqual(['source', 'tm-0'])
    expect(document.activeElement, 'focus fell to <body> when the shown view was closed').not.toBe(document.body)
    // AND IT IS IN THE VIEW THAT BECAME FOCUSED, which is what spec §11 actually promises — not merely
    // somewhere other than `<body>`.
    expect(mounted(), 'the stage mounts a view other than the focused one').toEqual([shown() as string])
    expect(
      host(shown() as string)?.contains(document.activeElement),
      'focus is not inside the view the stage now shows',
    ).toBe(true)
  })

  /**
   * §5: "`+ view` adds the pick beside the focused view … so in Stage the new tab sits after the focused
   * one". It is the ONLY route that adds a view on the stage, because the `⋯` menu's split items are
   * removed there — so a `+ view` whose result is invisible leaves the stage with no working way to add.
   */
  it('shows the view that + view creates', () => {
    const before = tabs()
    document.querySelector<HTMLButtonElement>('#new-view')?.click()
    const item = document.querySelector<HTMLButtonElement>('#new-view-menu button')
    expect(item, '+ view offered nothing to pick').not.toBeNull()
    item?.click()
    const menu = document.querySelector<HTMLElement>('#new-view-menu')
    if (menu?.matches(':popover-open')) menu.hidePopover()

    expect(tabs().length, '+ view added no tab').toBe(before.length + 1)
    const created = tabs().find((id) => !before.includes(id)) as string
    expect(shown(), 'the created view is not the one the stage shows').toBe(created)
    expect(mounted(), 'the created view is not the host on the page').toEqual([created])
  })
})
