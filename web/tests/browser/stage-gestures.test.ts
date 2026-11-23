import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { clickWorkspaceItem, host, mounted, SHELL, selectedTab, stateIdle, tabLeaves, until } from './harness'

/**
 * **A VIEW CLOSED WHILE THE STAGE IS UP.** `stage.test.ts` drives the switch and the tabs; this file drives `✕`,
 * because it names a leaf through `pane-host.ts`'s `focusPane` and the stage mounts only one host — so a leaf it
 * names may not be on the page at all.
 */

describe('the stage, under the gesture that closes a view', () => {
  beforeAll(async () => {
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
   * `fourViews()`, closing `lambda-0` names `source`, and the fallback is `rxm-0`. Closing `rxm-0` instead
   * makes them agree — both are `lambda-0`, the leaf before it and the first one left that is not the source —
   * so a version of this case that picked that view would pass against a stage that mounted the fallback.
   */
  it('does not strand the focus when the shown view is closed', () => {
    clickWorkspaceItem('[data-preset="stage"]')
    expect(tabLeaves(), 'the stage is not showing the four views').toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0'])
    expect(selectedTab(), 'the precondition is that lambda-0 is the shown view').toBe('lambda-0')

    const close = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-close')
    expect(close, 'the shown view offers no ✕ to click').not.toBeNull()
    close?.focus()
    expect(document.activeElement, 'the ✕ did not take the focus').toBe(close)
    close?.click()

    expect(tabLeaves()).toEqual(['source', 'rxm-0', 'tm-0'])
    expect(document.activeElement, 'focus fell to <body> when the shown view was closed').not.toBe(document.body)
    // AND IT IS IN THE VIEW THAT BECAME FOCUSED, which is what spec §11 actually promises — not merely
    // somewhere other than `<body>`.
    expect(mounted(), 'the stage mounts a view other than the focused one').toEqual([selectedTab() as string])
    expect(
      host(selectedTab() as string)?.contains(document.activeElement),
      'focus is not inside the view the stage now shows',
    ).toBe(true)
  })
})
