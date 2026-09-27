import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A TM VIEW IS BUILT WITH THE DISPLAY ITS WORKSPACE STORED** (Plan 7 part 4, spec §8 and §11). Seeded before
 * `main.ts` is imported, as `lambda-display-restore.test.ts` is, and for its reason: only the seed crosses all
 * three places the display does on its way back — `main.ts` restoring it into the workspace, `tmDisplayOf`
 * answering for the leaf, and `pane-host.ts` building the view with it. A click reads a display this page wrote a
 * moment earlier, never one it loaded.
 *
 * **BOTH FIELDS AWAY FROM THEIR DEFAULTS, AND ONE OF THEM DISABLED**: at the local level *arcs | chips* cannot
 * apply, so the stored *chips* is only seen once the level is switched back — and it must still be there.
 */
beforeAll(async () => {
  await page.viewport(1280, 2400)
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({ ...defaultWorkspace(), tmDisplay: { 'tm-0': { level: 'local', edges: 'chips' } } }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

const pane = () => document.querySelector('[data-leaf="tm-0"]') as HTMLElement
const diagram = () => pane().querySelector('[data-panel="diagram"]') as HTMLElement
const choice = (value: string) =>
  [...diagram().querySelectorAll<HTMLButtonElement>('.diagram-mode')].find((b) => b.dataset.value === value)
/** Whether an element is drawn: `hidden` is not enough, since an author `display` can outrank it. */
const drawn = (sel: string) => getComputedStyle(diagram().querySelector(sel) as HTMLElement).display !== 'none'

describe('a TM view restored from a stored workspace', () => {
  it('draws the level and the edges the workspace stored for it', async () => {
    await until(() => diagram().querySelectorAll('.local-node').length > 0, 'the local level to draw')
    expect(drawn('.local-level')).toBe(true)
    expect(drawn('.program-level')).toBe(false)
    expect(choice('local')?.getAttribute('aria-checked')).toBe('true')
    expect(choice('chips')?.getAttribute('aria-checked')).toBe('true')
    expect(choice('chips')?.disabled).toBe(true)
    // THE PROGRAM LEVEL IS KEPT CURRENT WHILE HIDDEN, and in *chips* it has no runtime column. Asked before the
    // switch, whose own `setEdges` would draw *chips* whether or not the view was built with it.
    expect(diagram().querySelector('.program-side')?.hasAttribute('hidden')).toBe(true)
    choice('program')?.click()
    await until(() => diagram().querySelectorAll('.program-row').length > 0, 'the program level to draw')
    expect(drawn('.program-level')).toBe(true)
    expect(diagram().querySelector('.program-side')?.hasAttribute('hidden')).toBe(true)
    expect(diagram().querySelectorAll('.program-arc')).toHaveLength(0)
    const chips = diagram().querySelector('.program-chips') as HTMLElement
    expect(chips.classList.contains('visually-hidden')).toBe(false)
  })

  /**
   * **A LEAF ID COMES BACK, AND ITS OLD DISPLAY MUST NOT COME WITH IT** — the rule `lambda-display-restore.test.ts`
   * holds for the λ view. `defaultLayout()` re-mints `tm-0`, so *reset preset* after closing the TM view hands its
   * id to a new view, which must be built with the defaults.
   */
  it('does not give a re-minted view the display of the one that closed', async () => {
    pane().querySelector<HTMLButtonElement>('button.view-close')?.click()
    await until(() => document.querySelector('[data-leaf="tm-0"]') === null, 'the TM view to close')
    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
    await until(
      () => document.querySelector('[data-leaf="tm-0"] [data-panel="diagram"] .program-row') !== null,
      'the re-minted view’s program level',
    )
    expect(choice('program')?.getAttribute('aria-checked')).toBe('true')
    expect(choice('arcs')?.getAttribute('aria-checked')).toBe('true')
    // The sample jumps nowhere, so *arcs* draws no arc: it is told by its runtime column and its unseen chips.
    expect(diagram().querySelector('.program-side')?.hasAttribute('hidden')).toBe(false)
    const chips = diagram().querySelector('.program-chips') as HTMLElement
    expect(chips.classList.contains('visually-hidden')).toBe(true)
  })
})
