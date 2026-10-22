import { beforeAll, describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY, serializeBuffers } from '../../src/buffers-store'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A RESTORED WORKSPACE OPENS PANELS DURING CONSTRUCTION.** `tests/browser/setup.ts` gives each file its
 * own in-memory `Storage`, and this file seeds three things into it: the source view's outline, a TM
 * view's outline, and a restored TM copy.
 *
 * **IT GUARDS TWO DEFECTS.**
 *
 * The first is a crash. `createOutlinePanel` calls `symbols()` during construction for a panel restored
 * open, so `main.ts`'s `lspClient` has to be built before anything that can call it. For a copy's view
 * TypeScript holds that: `createTransport` takes the client as a value. For the source view it does not,
 * because `symbols` there is a closure, and a closure that reads a `const` before its line has run
 * compiles and throws, so the page would die before it finished loading.
 *
 * **THE SEED HAS TO INCLUDE THE SOURCE PANEL.** The TM view's `symbols` thunk (`CopyEditor`'s) is
 * `async`, so the throw would become a rejection that `createOutlinePanel`'s own `.catch` swallows, and
 * nothing would surface. `main.ts`'s is a plain arrow, so it would throw synchronously out of `main()`
 * and `ready` would reject.
 *
 * The second is quieter: the outline's open state is written through `on.panel`, and unless `pane-host.ts`
 * reads it back too, not only `rules`, it is persisted correctly and restored closed every time.
 */
describe('a workspace restored with a panel already open', () => {
  let errors: string[] = []

  beforeAll(async () => {
    errors = []
    window.addEventListener('error', (e) => errors.push(String(e.message)))
    window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)))

    // **A RESTORED COPY, NOT JUST A RESTORED PANEL, AND BOTH ARE NEEDED.** The TM view's case, 'renders
    // into the restored panel rather than leaving it blank' below, wants a pane that resolves
    // `lspDocument` while it is being constructed, and only a pane with an EDITOR does that —
    // `CopyEditor`'s `#syncEditorControls` refreshes the outline when `#editor` is non-null. A restored
    // buffer is what gives a pane an editor at construction; with the panel open but no copy, the TM view
    // resolves nothing.
    const ws = defaultWorkspace('wide')
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
   * **THE ASSERTION ABOVE CANNOT SEE THE TM VIEW'S PANEL FAIL, WHICH IS WHY THIS ONE EXISTS.** The TM
   * copy's `symbols()` is async, so a throw in it would become a rejected promise that
   * `createOutlinePanel`'s own `.catch` swallows, and nothing would reach `window.onerror`. A client
   * handed to the transport unbuilt does not compile (the file doc), so what this catches is a request
   * that fails while the pane is being constructed.
   *
   * What a failed request DOES change is whether the panel was ever rendered into. A resolved request paints
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
