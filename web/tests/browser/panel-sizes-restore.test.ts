import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { drawn, host, SHELL, until } from './harness'

/**
 * **STORED SHARES, THROUGH THE REAL APP'S LOAD** — the view layouts spec §11.4. Seeded before `main.ts` is imported,
 * as `workspace-restore.test.ts` seeds its panels, because `main()` reads storage once. The TM view is built by
 * `pane-host.ts` with the shares its leaf holds, and the source view, which nothing builds, by `main.ts` with its own.
 *
 * Each view is given the reverse of what it is built with, so a load that read nothing fails: the state diagram two
 * shares to the rules' one, and the source outline, which has its own height until a boundary is dragged, a share
 * even with the editor's.
 */

const SIZES = { 'tm-0': { rules: 1, diagram: 2 }, source: { outline: 1, editor: 1 } }

const heightOf = (el: Element): number => el.getBoundingClientRect().height
const region = (leaf: string, name: string): HTMLElement =>
  (host(leaf) as HTMLElement).querySelector(`[data-region="${name}"]`) as HTMLElement

beforeAll(async () => {
  await page.viewport(1280, 896)
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({ ...defaultWorkspace('wide'), panels: { source: { outline: true } }, panelSizes: SIZES }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  await until(() => host('tm-0')?.querySelector('.state-table .state-row') != null, 'the rule table to draw')
  expect(drawn(), 'precondition: the page opened on the stored tree').toBe('row[50](source tm-0)')
  // THE PAGE'S FONTS FIRST: a line's height is the font's, and a floor of five lines, a header and the view's own
  // height each settle as the fonts arrive (`panel-sizes-restore-lambda.test.ts` has the figures).
  await document.fonts.ready
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
})

describe('a workspace stored with shares', () => {
  it('opens the TM view with its state diagram twice its rules, as stored', () => {
    const [rules, diagram] = [heightOf(region('tm-0', 'rules')), heightOf(region('tm-0', 'diagram'))]
    expect(rules, 'precondition: the rules are over their floor, so the shares are what sized them').toBeGreaterThan(
      160,
    )
    expect(diagram / rules).toBeCloseTo(2, 1)
    // A VIEW IS BUILT OFF THE PAGE, where there is nothing to measure: its boundary says the two at its focus.
    const boundary = (host('tm-0') as HTMLElement).querySelector('.panel-boundary') as HTMLElement
    boundary.focus()
    expect(boundary.getAttribute('aria-valuenow'), 'the boundary does not say the rules’ part of the two').toBe('33')
  })

  it('opens the source view with its outline sharing the view evenly with the editor, as stored', () => {
    const outline = region('source', 'outline')
    expect(outline.dataset.sized, 'the outline has its own height, as one nobody dragged').toBe('true')
    expect(heightOf(outline)).toBeCloseTo(heightOf(region('source', 'editor')), 0)
    expect(heightOf(outline), 'precondition: an even share is far more than the outline lists').toBeGreaterThan(300)
  })

  it('keeps them through the writes the load itself makes', () => {
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null').panelSizes).toEqual(SIZES)
  })
})
