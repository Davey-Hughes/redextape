import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { NARROW_WINDOW, NARROW_WINDOW_REM, workspaceItems } from '../../src/app-header'
import { HEADER_ORDER } from '../../src/layout'
import { PRESETS } from '../../src/workspace'
import { holdsFocus, mountAt, mounted, pickPreset, resetToFourViews, tabLeaves, toggle, until } from './harness'

/**
 * WHERE THE `views` TOGGLES ARE, BY THE WINDOW'S WIDTH — the view layouts spec §6.1. `main.ts` puts the group first in
 * the workspace menu, as a row named `show`, in a window 40rem wide or narrower (`NARROW_WINDOW`), and in the header
 * in a wider one. Before `main.ts` runs, `style.css` keeps it off the header there, by a rule whose width is written
 * again since a stylesheet imports nothing. **EACH IS READ AT THE LAST WIDTH THAT MOVES THE GROUP AND AT THE FIRST
 * THAT DOES NOT**, so a width that differs from the other's by a pixel fails (`tests/node/app-header.test.ts` holds
 * the rule's text to the query's). The toggles in the menu are the header's own buttons, so what is held of them there
 * is what the menu changes: where they are drawn, the menu left open, and the focus as the menu or the window changes.
 */

const group = (): HTMLElement => document.querySelector('#views-shown') as HTMLElement
const menu = (): HTMLElement => document.querySelector('#workspace-menu') as HTMLElement
const header = (): HTMLElement => document.querySelector('header.bar') as HTMLElement
const inMenu = (): boolean => group().parentElement === menu()
const inHeader = (): boolean => group().parentElement === header()
const isOpen = (): boolean => menu().matches(':popover-open')
const toggles = (): HTMLElement[] => [...group().querySelectorAll<HTMLElement>('button.view-toggle')]

/** Open the workspace menu with a click on its button, as a user does. */
async function open(): Promise<void> {
  await userEvent.click(document.querySelector('#workspace') as HTMLElement)
  expect(isOpen(), 'precondition: the workspace menu is open').toBe(true)
}

/** `el` is drawn, and its box lies inside the open workspace menu's. */
function expectInsideMenu(el: HTMLElement, what: string): void {
  const box = el.getBoundingClientRect()
  const rect = menu().getBoundingClientRect()
  expect(box.width, `${what}'s width`).toBeGreaterThan(0)
  expect(box.height, `${what}'s height`).toBeGreaterThan(0)
  expect(box.left, `${what}'s left`).toBeGreaterThanOrEqual(rect.left)
  expect(box.right, `${what}'s right`).toBeLessThanOrEqual(rect.right)
  expect(box.top, `${what}'s top`).toBeGreaterThanOrEqual(rect.top)
  expect(box.bottom, `${what}'s bottom`).toBeLessThanOrEqual(rect.bottom)
}

/** All four views, as tiles, in a window 1280 px wide, and then the window `width` px wide. */
async function startAt(width: number): Promise<void> {
  await page.viewport(1280, 896)
  await resetToFourViews()
  await page.viewport(width, 896)
}

beforeAll(() => mountAt(1280, 896))

afterEach(() => {
  if (isOpen()) menu().hidePopover()
})

describe('the views toggles, at the width that moves them', () => {
  // A REM IS 16 PX HERE, AS AT A BROWSER'S DEFAULT TEXT SIZE, which each case holds before it reads a width.
  const edge = NARROW_WINDOW_REM * 16

  it.each([
    [edge + 1, false, true],
    [edge, true, false],
    [edge + 1, false, true],
  ] as const)(
    'at %i px: in the workspace menu %s, and a group in the header drawn %s by the stylesheet',
    async (width, moved, drawn) => {
      await page.viewport(width, 896)
      expect(window.innerWidth, 'precondition: the window is the width asked for').toBe(width)
      expect(matchMedia(`(max-width: ${edge}px)`).matches, 'precondition: a rem is 16 px in this window').toBe(
        matchMedia(NARROW_WINDOW).matches,
      )
      await until(moved ? inMenu : inHeader, `the group to follow the window to ${width} px`)
      // THE RULE IS READ ON A PROBE, a group of the class in the header, which is where the page's own group is before
      // `main.ts` runs and is not at this width once it has.
      const probe = document.createElement('div')
      probe.className = 'views-shown'
      header().append(probe)
      try {
        expect(getComputedStyle(probe).display !== 'none', `the stylesheet’s rule at ${width} px`).toBe(drawn)
      } finally {
        probe.remove()
      }
    },
  )
})

describe('the views toggles, in a narrow window', () => {
  it('are the workspace menu’s first group, named show, drawn inside it, and the header holds none', async () => {
    await startAt(600)
    await until(inMenu, 'the group to move into the workspace menu')
    await open()
    expect(menu().firstElementChild, 'the group is not the menu’s first').toBe(group())
    expect(group().getAttribute('role')).toBe('group')
    expect(group().getAttribute('aria-label')).toBe('show')
    expect(getComputedStyle(group(), '::before').content, 'the row’s label as drawn').toBe('"show"')
    // THE `tiles`/`stage` ROW KEEPS ITS OWN NAME, so the menu has no two rows of one name.
    expect(
      menu().querySelector('[data-switch="views"]')?.closest('[role="group"]')?.getAttribute('aria-label'),
      'the tiles/stage row’s name',
    ).toBe('views')
    expect(toggles()).toHaveLength(HEADER_ORDER.length)
    for (const t of toggles()) expectInsideMenu(t, `the ${t.dataset.shows} toggle`)
    expect(document.querySelector('header.bar > .views-shown'), 'a group in the header').toBeNull()

    await userEvent.keyboard('{Escape}')
    expect(isOpen(), 'precondition: the menu is shut').toBe(false)
    await page.viewport(1280, 896)
    await until(inHeader, 'the group to come back to the header')
    expect(group().previousElementSibling, 'the group is not after the workspace menu').toBe(menu())
    await open()
    expect(menu().querySelector('.view-toggle'), 'a toggle in the menu of a wide window').toBeNull()
  })

  it('show and hide views as the header’s do, with the pressed look, and leave the menu open', async () => {
    await startAt(600)
    await until(inMenu, 'precondition: the group is in the workspace menu')
    await open()
    const lambda = toggle('lambda')
    await userEvent.click(lambda)
    expect(mounted()).not.toContain('lambda-0')
    expect(lambda.getAttribute('aria-pressed')).toBe('false')
    expect(getComputedStyle(lambda).boxShadow, 'the pressed look on a toggle not pressed').toBe('none')
    expect(isOpen(), 'the press shut the menu').toBe(true)
    await userEvent.click(lambda)
    expect(mounted()).toContain('lambda-0')
    expect(lambda.getAttribute('aria-pressed')).toBe('true')
    expect(getComputedStyle(lambda).boxShadow, 'the pressed look').toContain('inset')
    expect(isOpen(), 'the second press shut the menu').toBe(true)

    const tm = toggle('tm')
    tm.focus()
    expect(document.activeElement, 'precondition: the TM toggle has the focus').toBe(tm)
    await userEvent.keyboard('{Enter}')
    expect(mounted()).not.toContain('tm-0')
    expect(document.activeElement, 'the key took the focus from the TM toggle').toBe(tm)
    expect(isOpen(), 'the key shut the menu').toBe(true)
  })

  /** Where the source view is the only one left, no view's title or `⋯` menu is there to bring another back. */
  it('bring views back to a page left with the source view alone', async () => {
    await startAt(600)
    await until(inMenu, 'precondition: the group is in the workspace menu')
    await open()
    for (const kind of ['lambda', 'rxm', 'tm']) await userEvent.click(toggle(kind))
    expect(mounted(), 'precondition: the source view alone').toEqual(['source'])
    expect(toggle('source').getAttribute('aria-disabled'), 'precondition: the source toggle is disabled').toBe('true')
    await userEvent.click(toggle('tm'))
    expect(mounted()).toContain('tm-0')
  })

  /** The Stage offers no split, so a pointer on a phone chooses its tabs here. */
  it('choose the Stage’s tabs', async () => {
    await startAt(600)
    try {
      await until(inMenu, 'precondition: the group is in the workspace menu')
      await open()
      await userEvent.click(menu().querySelector('[data-preset="stage"]') as HTMLElement)
      expect(isOpen(), 'precondition: the pick left the menu open').toBe(true)
      expect(tabLeaves(), 'precondition: the λ view is a tab').toContain('lambda-0')
      await userEvent.click(toggle('lambda'))
      expect(tabLeaves()).not.toContain('lambda-0')
      await userEvent.click(toggle('lambda'))
      expect(tabLeaves()).toContain('lambda-0')
    } finally {
      pickPreset('explorer')
    }
  })

  /** A pick repaints the menu under the user's hand (`workspaceItems`), and the group is not part of what it builds. */
  it('stay first in the menu across a pick that repaints it', async () => {
    await startAt(600)
    try {
      await until(inMenu, 'precondition: the group is in the workspace menu')
      await open()
      await userEvent.click(menu().querySelector('[data-preset="debugger"]') as HTMLElement)
      const picked = menu().querySelector('[data-preset="debugger"]') as HTMLElement
      expect(isOpen(), 'the pick shut the menu').toBe(true)
      expect(menu().firstElementChild, 'the group is not the repainted menu’s first').toBe(group())
      expect(toggles()).toHaveLength(HEADER_ORDER.length)
      expect(picked.getAttribute('aria-current')).toBe('true')
      expect(document.activeElement, 'the focus is not on the item picked').toBe(picked)
    } finally {
      pickPreset('explorer')
    }
  })

  it('keep a toggle’s focus when the window widens with it in the menu', async () => {
    await startAt(600)
    await until(inMenu, 'precondition: the group is in the workspace menu')
    await open()
    const lambda = toggle('lambda')
    lambda.focus()
    expect(document.activeElement, 'precondition: the λ toggle has the focus').toBe(lambda)
    expect(menu().contains(lambda), 'precondition: the λ toggle is in the menu').toBe(true)
    await page.viewport(1280, 896)
    await until(inHeader, 'the group to come back to the header')
    await holdsFocus(lambda, 'the λ toggle lost the focus as the window widened')
    expect(menu().contains(document.activeElement), 'the focus is in the workspace menu').toBe(false)
  })

  it('follow the window across 40rem with the menu open', async () => {
    const edge = NARROW_WINDOW_REM * 16
    await startAt(edge + 1)
    await until(inHeader, 'precondition: the group is in the header')
    await open()
    expect(menu().querySelector('.view-toggle'), 'precondition: no toggle in the menu').toBeNull()
    await page.viewport(edge, 896)
    await until(inMenu, 'the group to move into the open menu')
    // NO REBUILD OF THE MENU HAS RUN, so the group's place is the move's own.
    expect(menu().firstElementChild, 'the group is not the open menu’s first').toBe(group())
    for (const t of toggles()) expectInsideMenu(t, `the ${t.dataset.shows} toggle`)
    expect(isOpen(), 'the move shut the menu').toBe(true)
    await page.viewport(edge + 1, 896)
    await until(inHeader, 'the group to come back to the header')
    expect(isOpen(), 'the move back shut the menu').toBe(true)
    const presets = [...menu().querySelectorAll<HTMLElement>('[data-preset]')]
    expect(presets).toHaveLength(3)
    for (const p of presets) expectInsideMenu(p, `the ${p.dataset.preset} preset`)
  })
})

describe('workspaceItems', () => {
  it('rebuilds the menu around the toggles’ group, and leaves a focus inside it', () => {
    const menu = document.createElement('div')
    const views = document.createElement('div')
    const [first, second] = [document.createElement('button'), document.createElement('button')]
    views.append(first, second)
    menu.append(views)
    document.body.append(menu)
    try {
      // THE SECOND, because a focus put back by the identity rule's fallback lands on the first.
      second.focus()
      expect(document.activeElement, 'precondition: the second button has the focus').toBe(second)
      workspaceItems(
        menu,
        { switches: PRESETS.explorer, reset: document.createElement('button'), views },
        { preset() {}, flip() {} },
      )
      expect(menu.firstElementChild, 'the group is not the menu’s first').toBe(views)
      expect(document.activeElement, 'the rebuild moved the focus').toBe(second)
      expect(views.nextElementSibling?.getAttribute('aria-label'), 'the presets after the group').toBe('preset')
    } finally {
      menu.remove()
    }
  })
})
