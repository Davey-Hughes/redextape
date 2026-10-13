import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, type LayoutNode } from '../../src/layout'
import { serializeWorkspace, type Workspace } from '../../src/workspace'
import { fourViews, fourViewWorkspace, SHELL, until } from './harness'

/**
 * A RELOAD BUILDS A VIEW THAT WAS OFF THE SCREEN FROM WHAT THE WORKSPACE STORED FOR IT — the view layouts spec §5.2.
 * After a reload a view off the page has no pane; it is built when its arrangement is entered, with the panel state
 * and the display stored under its id.
 *
 * The page opens on a stored workspace showing the source beside the asm view, which remembers all four views, and
 * stores a shut rules panel and a display for the TM view and a display for the λ view: two views only the remembered
 * arrangement holds. `parked-view-state.test.ts` holds that a switch stores this; here it is what a load is handed.
 *
 * **THE FIRST LAYOUT WRITES THE WORKSPACE BACK, AND THAT WRITE MUST KEEP THEM.** `main.ts`'s `normaliseWorkspace` runs
 * before every write and drops what is stored for a view that is not live. Asked of the tree on screen alone, it
 * dropped these at the load, from memory too, with every other test passing (measured on `ee09243`, 2026-10-12): the
 * views were then built with the defaults.
 *
 * Storage is read once, at the mount, so the workspace is stored before it and this is a file of its own.
 */

const ON_SCREEN: LayoutNode = {
  kind: 'split',
  dir: 'row',
  sizes: [0.5, 0.5],
  children: [
    { kind: 'leaf', id: 'source', pane: 'source' },
    { kind: 'leaf', id: 'asm-0', pane: 'asm' },
  ],
}
const PANELS = { 'tm-0': { rules: false } }
const DISPLAY = { 'lambda-0': { layout: 'outline', vars: 'debruijn', map: 'icicle' } } as const
const TM_DISPLAY = { 'tm-0': { level: 'program', edges: 'chips' } } as const

const leaf = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${id}"]:not([role="tab"])`)
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const press = (kind: string): Promise<void> =>
  userEvent.click(document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`) as HTMLElement)
const stored = (): Pick<Workspace, 'panels' | 'display' | 'tmDisplay' | 'arrangements'> =>
  JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null')

beforeAll(async () => {
  await page.viewport(1280, 896)
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({
      ...fourViewWorkspace(),
      tree: ON_SCREEN,
      focused: 'asm-0',
      arrangements: { 'source+lambda+asm+tm': fourViews() },
      panels: PANELS,
      display: DISPLAY,
      tmDisplay: TM_DISPLAY,
    }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('a stored workspace that keeps panel state and displays for views off the screen', () => {
  it('still stores them once the page has loaded and written its workspace back', () => {
    // A WORKSPACE THE LOADER REFUSED WOULD HAVE OPENED ON THE DEFAULT, the source beside the TM view.
    expect(mounted(), 'precondition: the page opened on the stored tree').toEqual(['source', 'asm-0'])
    expect(Object.keys(stored().arrangements), 'precondition: all four views are remembered').toEqual([
      'source+lambda+asm+tm',
    ])
    expect.soft(stored().panels, 'the load dropped a parked view’s panel state').toEqual(PANELS)
    expect.soft(stored().display, 'the load dropped a parked view’s display').toEqual(DISPLAY)
    expect.soft(stored().tmDisplay, 'the load dropped a parked view’s display').toEqual(TM_DISPLAY)
  })

  it('builds each view from them when its toggle is pressed', async () => {
    await press('tm')
    expect(mounted(), 'precondition: the TM view is built').toEqual(['source', 'asm-0', 'tm-0'])
    const tm = leaf('tm-0') as HTMLElement
    expect(
      tm.querySelector('[data-panel="rules"] .panel-toggle')?.getAttribute('aria-expanded'),
      'the TM view was built with its rules panel open',
    ).toBe('false')
    const chips = [...tm.querySelectorAll<HTMLButtonElement>('[data-panel="diagram"] .diagram-mode')].find(
      (b) => b.dataset.value === 'chips',
    )
    expect(chips?.getAttribute('aria-checked'), 'the TM view was built drawing arcs').toBe('true')

    await press('lambda')
    expect(mounted(), 'precondition: all four views, as remembered').toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
    const choice = (value: string): string | null | undefined =>
      leaf('lambda-0')?.querySelector(`.view-menu-choice[data-value="${value}"]`)?.getAttribute('aria-checked')
    expect(choice('outline'), 'the λ view was built drawing code').toBe('true')
    expect(choice('debruijn'), 'the λ view was built showing names').toBe('true')
  })
})
