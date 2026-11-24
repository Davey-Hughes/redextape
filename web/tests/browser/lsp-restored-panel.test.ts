import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A RESTORED WORKSPACE OPENS PANELS DURING CONSTRUCTION.** `tests/browser/setup.ts` gives each file its
 * own in-memory `Storage`, and this file seeds the source view's outline into it, open, and an `outline` entry
 * under the TM view's leaf, which a load carries whether or not the view draws that panel.
 *
 * **IT GUARDS TWO DEFECTS.**
 *
 * The first is a crash. `createOutlinePanel` calls `symbols()` during construction for a panel restored
 * open, so `main.ts`'s `lspClient` has to be built before anything that can call it. For the source view
 * TypeScript does not hold that, because `symbols` there is a closure, and a closure that reads a `const`
 * before its line has run compiles and throws: a plain arrow, so it would throw synchronously out of `main()`,
 * `ready` would reject, and the page would die before it finished loading.
 *
 * The second is quieter: the outline's open state is written through the panel's `onToggle`, and unless `main.ts`
 * reads it back from the workspace when it builds the panel, it is persisted correctly and restored closed every
 * time.
 */
describe('a workspace restored with a panel already open', () => {
  let errors: string[] = []

  beforeAll(async () => {
    errors = []
    window.addEventListener('error', (e) => errors.push(String(e.message)))
    window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)))

    const ws = defaultWorkspace('wide')
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      serializeWorkspace({ ...ws, panels: { ...ws.panels, source: { outline: true }, 'tm-0': { outline: true } } }),
    )

    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
  })

  it('loads without throwing', async () => {
    await until(() => document.querySelector('[data-leaf="tm-0"]') !== null, 'the TM view to mount')
    expect(errors, `the page threw while loading: ${errors.join(' | ')}`).toEqual([])
  })

  /**
   * **A RESTORED PANEL IS RENDERED INTO**: the request `createOutlinePanel` makes at construction resolves, and paints
   * rows or the "nothing to show" line. A rejected one leaves the body exactly as it was built — empty, and
   * `createOutlinePanel`'s own `.catch` swallows the rejection, so nothing reaches `window.onerror` and the case
   * above cannot see it. So the observable difference is that the body has content at all.
   */
  it('renders into the restored panel rather than leaving it blank', async () => {
    await until(
      () => (document.querySelector('[data-leaf="source"] .outline')?.childElementCount ?? 0) > 0,
      'the restored outline to render something — rows, or the empty line',
    )
  })

  it('restores the panel open rather than closed', () => {
    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-leaf="source"] [data-panel="outline"] button[aria-expanded]',
    )
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
  })
})
