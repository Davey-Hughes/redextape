import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A λ VIEW IS BUILT WITH THE DISPLAY ITS WORKSPACE STORED** (Plan 7 part 4a, spec §5.1). Seeded before
 * `main.ts` is imported, as `workspace-restore.test.ts` is, because `main()` reads storage once.
 *
 * **SEEDED RATHER THAN REACHED BY A CROSS-LEG REBIND, BECAUSE ONLY THE SEED CROSSES ALL THREE PLACES THE
 * DISPLAY DOES ON ITS WAY BACK:** `main.ts` restoring it into the workspace, `displayOf` answering for the
 * leaf, and `pane-host.ts` building the view with it. A rebind from TM back to λ rebuilds the view from
 * the same `displayOf`, but reads a display this page wrote a moment earlier, never one it loaded — so it
 * cannot see the restore drop the field. It is also a reload, which is the case a user meets.
 */
const STORED = { layout: 'outline', vars: 'debruijn', map: 'minimap' } as const

beforeAll(async () => {
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({
      ...defaultWorkspace(),
      display: { 'lambda-0': STORED },
      // ITS TERM MAP LEFT OPEN: a λ view's panel state comes back as a TM view's does.
      panels: { 'lambda-0': { map: true } },
    }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

const term = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term')
const rows = () => document.querySelectorAll('[data-leaf="lambda-0"] .term-line').length
const checked = (value: string) =>
  document
    .querySelector(`[data-leaf="lambda-0"] .view-menu-choice[data-value="${value}"]`)
    ?.getAttribute('aria-checked')

describe('a λ view restored from a stored workspace', () => {
  it('draws with the layout and the variables the workspace stored for it', async () => {
    // STEP 0, WHERE THE TERM STILL HAS BINDERS TO PRINT — the page opens on the last step, a numeral chip.
    ;[...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')]
      .find((b) => b.textContent === '↺')
      ?.click()
    await until(
      () => term()?.dataset.step === '0' && term()?.dataset.stale === undefined && rows() > 0,
      'step 0’s tree',
    )
    expect(term()?.dataset.layout).toBe('outline')
    // A BINDER BY NAME READS `λx`; BY INDEX, `λ.` — so no letter directly after a `λ` is the de Bruijn mode.
    expect(term()?.textContent).toMatch(/λ\./)
    expect(term()?.textContent).not.toMatch(/λ\p{L}/u)
    expect(checked('outline')).toBe('true')
    expect(checked('debruijn')).toBe('true')
  })

  it('opens its term map if the workspace left it open, in the mode the workspace stored', async () => {
    const map = () => document.querySelector('[data-leaf="lambda-0"] [data-panel="map"]')
    expect(map()?.querySelector('.panel-toggle')?.getAttribute('aria-expanded')).toBe('true')
    expect(map()?.querySelector('.map-mode[data-value="minimap"]')?.getAttribute('aria-checked')).toBe('true')
    await until(
      () => /^term map: \d+ lines$/.test(map()?.querySelector('.term-map')?.getAttribute('aria-label') ?? ''),
      'the minimap to draw',
    )
  })

  /**
   * **A LEAF ID COMES BACK, AND ITS OLD DISPLAY MUST NOT COME WITH IT** — `workspace-restore.test.ts`'s rule
   * for panel state, held for the display. `defaultLayout()` re-mints `lambda-0`, so *reset preset* after
   * closing the λ view hands its id to a new view. The write already dropped the closed view's display; the
   * workspace in memory has to drop it too, or the new view is built from it and a reload would draw it
   * differently from the same clicks.
   */
  it('does not give a re-minted view the display of the one that closed', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-close')?.click()
    await until(() => document.querySelector('[data-leaf="lambda-0"]') === null, 'the λ view to close')
    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
    await until(() => rows() > 0 && term()?.dataset.stale === undefined, 'the re-minted view’s tree')
    expect(term()?.dataset.layout).toBe('code')
    expect(checked('code')).toBe('true')
    expect(checked('names')).toBe('true')
    expect(
      document.querySelector('[data-leaf="lambda-0"] .map-mode[data-value="icicle"]')?.getAttribute('aria-checked'),
    ).toBe('true')
  })
})
