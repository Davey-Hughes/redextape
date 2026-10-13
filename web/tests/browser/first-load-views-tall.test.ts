import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { focusInPage, host, SHELL, until } from './harness'

/**
 * A FIRST VISIT IN A WINDOW TALLER THAN IT IS WIDE — the view layouts spec §4.4: the source above the TM view, where
 * a wide window has them side by side (`first-load-views.test.ts`). Its own file because `main()` measures the views
 * area once, as it builds the first workspace, and a file mounts the app once.
 */

localStorage.removeItem(LAYOUT_STORAGE_KEY)

const box = (leaf: string): DOMRect => (host(leaf) as HTMLElement).getBoundingClientRect()

describe('a first load, in a window taller than it is wide', () => {
  beforeAll(async () => {
    await page.viewport(414, 896)
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  })

  it('measured a views area taller than it is wide: the precondition', () => {
    const area = (document.querySelector('#views') as HTMLElement).getBoundingClientRect()
    expect(area.height).toBeGreaterThan(area.width)
  })

  it('puts the source above the TM view, each the full width', () => {
    const source = box('source')
    const tm = box('tm-0')
    expect(Math.abs(source.left - tm.left), 'the two views do not share a left edge').toBeLessThan(1)
    expect(source.bottom, 'the TM view does not start where the source view ends').toBeLessThanOrEqual(tm.top)
    expect(Math.abs(source.width - tm.width)).toBeLessThan(1)
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null').tree.dir).toBe('column')
  })

  /**
   * ***RESET PRESET* MEASURES THE AREA TOO** (spec §4.6): it builds the first-load tree, and in this window that is a
   * column. `main.ts`'s reset handler reads the shape for itself, apart from the start-up's read, and with its
   * `viewsShape()` dropped it stored a row here while every browser file passed.
   *
   * **FROM THREE VIEWS, SO THE COLUMN OF TWO IS THE RESET'S**: the page opened on that column, and a reset that left
   * the tree alone would pass a case that started there.
   */
  it('builds the same column when reset preset is pressed', async () => {
    document.querySelector<HTMLButtonElement>('#views-shown button[data-shows="lambda"]')?.click()
    await until(() => document.querySelector('#views [data-leaf="lambda-0"]') !== null, 'the λ view to be shown')
    const area = (document.querySelector('#views') as HTMLElement).getBoundingClientRect()
    expect(area.height, 'the views area is not taller than wide at the reset').toBeGreaterThan(area.width)
    // WITH THE POINTER, the workspace button and then its item: the reset is what this case is about.
    await userEvent.click(document.querySelector('#workspace') as HTMLElement)
    await userEvent.click(document.querySelector('#reset-preset') as HTMLElement)
    await focusInPage('reset preset, pressed in a window taller than it is wide')
    // IN THE TM VIEW, WHICH IS WHERE THE RESET PUTS IT: the workspace button has it once the menu is shut, and a
    // reset that handed it nowhere would leave it there, in the page and in the wrong place.
    expect(
      document.activeElement?.closest<HTMLElement>('#views [data-leaf]')?.dataset.leaf,
      'the view the focus is in after the reset',
    ).toBe('tm-0')
    await until(() => document.querySelector('#views [data-leaf="lambda-0"]') === null, 'the reset to take the λ view')
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null').tree).toEqual({
      kind: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [
        { kind: 'leaf', id: 'source', pane: 'source' },
        { kind: 'leaf', id: 'tm-0', pane: 'tm' },
      ],
    })
    const source = box('source')
    const tm = box('tm-0')
    expect(Math.abs(source.left - tm.left), 'the two views do not share a left edge').toBeLessThan(1)
    expect(source.bottom, 'the TM view does not start where the source view ends').toBeLessThanOrEqual(tm.top)
    expect(Math.abs(source.width - tm.width)).toBeLessThan(1)
  })
})
