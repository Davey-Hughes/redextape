import { beforeAll, describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY, serializeBuffers } from '../../src/buffers-store'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A RESTORED WORKSPACE OPENS PANELS DURING CONSTRUCTION, AND EVERY OTHER TEST STARTS WITH EMPTY
 * STORAGE.** `tests/browser/setup.ts` gives each file its own in-memory `Storage`, so no test had
 * ever mounted the app with a panel already open, or with a copy already bound. This file seeds all
 * three: the source view's outline, a TM view's outline, and a restored TM copy.
 *
 * **IT GUARDS TWO DEFECTS, AND BOTH SABOTAGES FIRE.**
 *
 * The first is a crash. `main.ts`'s `lspClient` was a `let` assigned after the editor was built,
 * while `createOutlinePanel` calls `symbols()` during construction for a panel restored open. The
 * page died on `Cannot read properties of undefined (reading 'documentSymbols')` before it finished
 * loading. TypeScript cannot see it: definite-assignment analysis does not follow closures. Building
 * the client above everything that can resolve the thunk is the fix; restoring the old order makes
 * this file exit 1.
 *
 * **THE SEED HAD TO BE THE SOURCE PANEL, AND AN EARLIER VERSION OF THIS FILE SEEDED THE TM ONE AND
 * CONCLUDED THE CRASH COULD NOT BE REPRODUCED.** It can. `TmPane`'s `symbols` thunk is `async`, so
 * the throw becomes a rejection that `createOutlinePanel`'s own `.catch` swallows and nothing
 * surfaces. `main.ts`'s is a plain arrow, so it throws synchronously out of `main()` and `ready`
 * rejects. Two thunks, one of which can show the defect — the docstring claimed "the old order" while
 * the seed exercised only the half that hides it.
 *
 * The second is quieter: `pane-host.ts` read `rules` and no other panel, so the outline's open state
 * was written through `on.panel` and never read back — persisted correctly, restored closed every
 * time. Stubbing that read-back out reddens two of the three cases below.
 */
describe('a workspace restored with a panel already open', () => {
  let errors: string[] = []

  beforeAll(async () => {
    errors = []
    window.addEventListener('error', (e) => errors.push(String(e.message)))
    window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)))

    // **A RESTORED COPY, NOT JUST A RESTORED PANEL, AND BOTH ARE NEEDED.** The crash wanted a pane
    // that resolves `lspDocument` while it is being constructed, and only a pane with an EDITOR does
    // that — `#syncEditorControls` refreshes the outline when `#editor` is non-null. A restored
    // buffer is what gives a pane an editor at construction. With the panel open but no copy, the
    // old order does not crash and this file was green against it.
    const ws = defaultWorkspace()
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      serializeWorkspace({ ...ws, panels: { ...ws.panels, source: { outline: true }, 'tm-0': { outline: true } } }),
    )
    localStorage.setItem(
      BUFFERS_STORAGE_KEY,
      serializeBuffers({
        minted: 1,
        buffers: [
          {
            id: 'scratch-1',
            label: 'copy 1',
            text: 'tapes 1\nstart s\n\nstate s: accept\n',
            collapsed: false,
            leg: 'tm',
          },
        ],
        bindings: { 'tm-0': 'scratch-1' },
      }),
    )

    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
  })

  it('loads without throwing', async () => {
    await until(() => document.querySelector('[data-leaf="tm-0"]') !== null, 'the TM view to mount')
    expect(errors, `the page threw while loading: ${errors.join(' | ')}`).toEqual([])
  })

  /**
   * **THE ASSERTION ABOVE DOES NOT CATCH THE BUG, WHICH IS WHY THIS ONE EXISTS.** Restoring the old
   * construction order under it leaves it green: `symbols()` is async, so reading `documentSymbols`
   * of `undefined` becomes a rejected promise, and `createOutlinePanel`'s own `.catch` swallows it.
   * Nothing reaches `window.onerror`.
   *
   * What the bug DOES change is whether the panel was ever rendered into. A resolved request paints
   * rows or the "nothing to show" line; a rejected one leaves the body exactly as it was built —
   * empty. So the observable difference is that the body has content at all.
   */
  it('renders into the restored panel rather than leaving it blank', async () => {
    await until(
      () => (document.querySelector('[data-leaf="tm-0"] .outline')?.childElementCount ?? 0) > 0,
      'the restored outline to render something — rows, or the empty line',
    )
  })

  it('restores the panel open rather than closed', () => {
    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-leaf="tm-0"] [data-panel="outline"] button[aria-expanded]',
    )
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
  })
})
