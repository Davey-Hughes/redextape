import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { armed, host, mounted, notice, PREFIX, SHELL, stateIdle, toggle, until } from './harness'
import { viewKey } from './user-event-fixture'

/**
 * VIEW KEYS UNDER AN OPEN POPOVER — the view layouts spec §7: a view key closes every open popover, as a pointer press
 * on the page behind one does, and then acts (`main.ts`'s VIEW KEYS doc, above `hintTitle`, has the choice). Each case
 * opens its popover with a real press, asserts it is open, and then reads four things after the key: what is open, what
 * the popover's button says of it, where the focus is, and the views.
 *
 * **AND THE TWO MENUS THAT OFFER `source` DO NOT OFFER IT ONCE A VIEW SHOWS IT**, by a road that is not a view key:
 * the source toggle, pressed from the keyboard with the menu still open. `+ view`'s menu is filled again when the tree
 * changes under it, and a view's `⋯` menu is closed, with its events, before its view's host is detached
 * (`pane-host.ts`'s `applyLayout`).
 *
 * **NO CASE FOR THE ENCODING SELECT'S LIST.** While it is open the browser gives the keys to the list, and the page is
 * sent no `keydown` for the prefix or for the key after it in this Chromium: the mode does not arm, nothing switches,
 * and the focus stays on the select. There is no code of the app's in that to hold.
 *
 * **EVERY CASE STARTS FROM ALL FOUR VIEWS WITH NOTHING OPEN**, which `start` puts back and asserts.
 */

const UNARMED = 'the prefix did not arm the mode with a popover open'
const SOURCE = 'let x = 40;\nx + 2'

let view: EditorView
/** Every uncaught error since the case began: a stale menu item's press would throw one. */
const errors: string[] = []

/** The popovers that are open, each by its id. */
const open = (): string[] => [...document.querySelectorAll<HTMLElement>(':popover-open')].map((p) => p.id)
const menuOf = (button: HTMLElement): HTMLElement => (button as HTMLButtonElement).popoverTargetElement as HTMLElement

/** Press `button` and wait for its popover, which is then the one thing open and what the button says is expanded. */
async function press(button: HTMLElement): Promise<HTMLElement> {
  await userEvent.click(button)
  const menu = menuOf(button)
  await until(() => menu.matches(':popover-open'), 'the popover to open')
  expect(open(), 'precondition: the one popover is open').toEqual([menu.id])
  expect(button.getAttribute('aria-expanded'), 'precondition: its button says it is open').toBe('true')
  return menu
}

async function start(): Promise<void> {
  for (const p of document.querySelectorAll<HTMLElement>(':popover-open')) p.hidePopover()
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views-shown button[aria-pressed="false"]')) b.click()
  view.focus()
  await until(() => view.hasFocus, 'the source editor to take the focus')
  errors.length = 0
  expect(mounted(), 'precondition: all four views').toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
  expect(open(), 'precondition: nothing is open').toEqual([])
  expect(armed(), 'precondition: the mode is not armed').toBe(false)
}

describe('view keys under an open popover', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SOURCE } })
    await until(
      () => stateIdle() && (document.querySelector('#results')?.textContent ?? '').includes('λ 42'),
      'the compile',
    )
    window.addEventListener('error', (e) => errors.push(e.message))
  })

  afterEach(async () => {
    if (armed()) await userEvent.keyboard('{Escape}')
  })

  /** The header's popovers: each is beside its button, outside the views, and no rebuild touches it. */
  it.each([
    ['the workspace menu', '#workspace'],
    ['+ view', '#new-view'],
    ['copies', '#buffers'],
    ['examples', '#examples'],
    ['share', '#share'],
    ['about', '#about'],
    ['settings', '#settings'],
  ])('closes %s, hands the focus to its button, and acts', async (_what, selector) => {
    await start()
    const button = document.querySelector(selector) as HTMLElement
    const menu = await press(button)
    // SO THAT THERE IS A FOCUS TO HAND BACK. Six of the seven take the focus as they open; the copies menu with no copy
    // leaves it on its button, where this case would pass with nothing handed anywhere, and `Tab` goes into it.
    if (!menu.contains(document.activeElement)) await userEvent.keyboard('{Tab}')
    expect(menu.contains(document.activeElement), 'precondition: the focus is inside the popover').toBe(true)
    await viewKey('2', UNARMED)
    expect(open(), 'the popover stayed open over a page the key changed').toEqual([])
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement, 'the focus is not on the popover’s button').toBe(button)
    expect(mounted(), 'the key did not hide the asm view').toEqual(['source', 'lambda-0', 'tm-0'])
    expect(errors).toEqual([])
  })

  it('leaves share no link to the arrangement the key replaced', async () => {
    await start()
    const share = document.querySelector('#share') as HTMLElement
    const link = (): string => document.querySelector<HTMLInputElement>('#share-link')?.value ?? ''
    await press(share)
    await until(() => link() !== '', 'the link to four views')
    const four = link()
    await viewKey('2', UNARMED)
    expect(open()).toEqual([])
    await press(share)
    await until(() => link() !== '', 'the link to three views')
    expect(link(), 'share opened on the link it had before the key').not.toBe(four)
  })

  it('says why a toggle key for the only view did nothing, with the popover closed over it', async () => {
    await start()
    for (const kind of ['asm', 'lambda', 'tm']) await userEvent.click(toggle(kind))
    expect(mounted()).toEqual(['source'])
    const settings = document.querySelector('#settings') as HTMLElement
    await press(settings)
    await viewKey('1', UNARMED)
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(settings)
    expect(mounted()).toEqual(['source'])
    expect(notice()).toBe('the source view is the only one shown — one view stays')
  })

  it('leaves the mode on the first Escape and the popover open, which the second closes', async () => {
    await start()
    const workspace = document.querySelector('#workspace') as HTMLElement
    const menu = await press(workspace)
    await userEvent.keyboard(PREFIX)
    expect(armed()).toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(armed()).toBe(false)
    expect(open(), 'the Escape that left the mode closed the menu too').toEqual([menu.id])
    await userEvent.keyboard('{Escape}')
    expect(open()).toEqual([])
    expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
  })

  /**
   * A view's own popovers, its `⋯` menu and its title's, are inside its host, and a rebuild detaches every host: left
   * open, each would come back shut with `aria-expanded="true"` on its button.
   */
  describe('a view’s own menus', () => {
    const more = (leaf: string): HTMLElement => host(leaf)?.querySelector('button.view-more') as HTMLElement

    it('closes the ⋯ menu of the view the key hides, and the focused view takes the focus', async () => {
      await start()
      const button = more('tm-0')
      const menu = await press(button)
      expect(menu.contains(document.activeElement), 'precondition: the focus is on an item of the menu').toBe(true)
      await viewKey('4', UNARMED)
      expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0'])
      expect(open()).toEqual([])
      expect(button.getAttribute('aria-expanded'), 'the ⋯ left the page saying its menu is open').toBe('false')
      expect(document.activeElement, 'the focus fell to <body>').not.toBe(document.body)
      expect(document.querySelector('#views')?.contains(document.activeElement)).toBe(true)
      await viewKey('4', UNARMED)
      expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
      expect(more('tm-0').getAttribute('aria-expanded'), 'the ⋯ came back saying its menu is open').toBe('false')
      expect(open()).toEqual([])
    })

    it.each([
      ['⋯ menu', 'button.view-more'],
      ['title’s menu', 'button.view-title'],
    ])('closes the %s of a view the key keeps, and its button has the focus', async (_what, selector) => {
      await start()
      const button = host('tm-0')?.querySelector(selector) as HTMLElement
      const menu = await press(button)
      expect(menu.contains(document.activeElement), 'precondition: the focus is on an item of the menu').toBe(true)
      await viewKey('2', UNARMED)
      expect(mounted()).toEqual(['source', 'lambda-0', 'tm-0'])
      expect(open()).toEqual([])
      expect(button.getAttribute('aria-expanded'), 'the button says its menu is open').toBe('false')
      expect(document.activeElement, 'the focus is not on the menu’s button').toBe(button)
      expect(errors).toEqual([])
    })
  })

  /** The two menus that offer `source` while no view shows it: `+ view`'s, and the list a view's split opens. */
  describe('a menu that offers source', () => {
    const sourceItem = (menu: HTMLElement): HTMLElement | null => menu.querySelector('button[data-source]')

    it('closes + view when a key shows the source view, and it opens again without the item', async () => {
      await start()
      await userEvent.click(toggle('source'))
      expect(mounted()).toEqual(['lambda-0', 'asm-0', 'tm-0'])
      const add = document.querySelector('#new-view') as HTMLElement
      const menu = await press(add)
      expect(sourceItem(menu), 'precondition: + view offers source').not.toBeNull()
      await viewKey('1', UNARMED)
      expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
      expect(open(), '+ view stayed open').toEqual([])
      await press(add)
      expect(sourceItem(menu), '+ view offers a source view the page has').toBeNull()
      expect(errors).toEqual([])
    })

    /**
     * NO VIEW KEY IN THIS ONE. A popover stays open while `Shift+Tab` walks out of it, so the source toggle can be
     * pressed with `+ view` open: back from the menu's first item to `+ view`, then the TM, λ, asm and source toggles.
     */
    it('takes source out of + view, still open, when the source toggle is pressed from the keyboard', async () => {
      await start()
      await userEvent.click(toggle('source'))
      const menu = await press(document.querySelector('#new-view') as HTMLElement)
      expect(sourceItem(menu), 'precondition: + view offers source').not.toBeNull()
      const others = menu.querySelectorAll('button').length - 1
      for (let i = 0; i < 5; i++) await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
      expect(document.activeElement, 'precondition: Shift+Tab reached the source toggle').toBe(toggle('source'))
      expect(open(), 'precondition: + view is still open').toEqual([menu.id])
      await userEvent.keyboard('{Enter}')
      expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
      expect(open(), 'the menu closed').toEqual([menu.id])
      expect(sourceItem(menu), '+ view still offers a source view the page has').toBeNull()
      expect(menu.querySelectorAll('button').length, 'the menu lost its other items').toBe(others)
      expect(errors).toEqual([])
    })

    it('closes a view’s split list when the source toggle is pressed from the keyboard, and ⋯ opens on its items', async () => {
      await start()
      await userEvent.click(toggle('source'))
      const button = host('tm-0')?.querySelector('button.view-more') as HTMLElement
      const menu = await press(button)
      const main = menu.querySelector('.view-menu-main') as HTMLElement
      const list = menu.querySelector('.view-menu-pairs') as HTMLElement
      const split = menu.querySelector('button.view-split[data-dir="row"]') as HTMLElement
      await userEvent.click(split)
      expect(sourceItem(list), 'precondition: the split’s list offers source').not.toBeNull()
      // THE FOCUS IS PUT ON THE TOGGLE, WHICH `Shift+Tab` REACHES FROM THE LIST: the press under test is the `Enter`.
      toggle('source').focus()
      expect(open(), 'precondition: the list is still open').toEqual([menu.id])
      await userEvent.keyboard('{Enter}')
      expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
      expect(open()).toEqual([])
      expect(button.getAttribute('aria-expanded'), 'the ⋯ says its menu is open').toBe('false')
      await press(button)
      expect(main.hidden, '⋯ opened on the list it had when its view was rebuilt').toBe(false)
      expect(list.children).toHaveLength(0)
      await userEvent.click(split)
      expect(list.children.length, 'precondition: the split’s list has items').toBeGreaterThan(0)
      expect(sourceItem(list), 'the split’s list offers a source view the page has').toBeNull()
      expect(errors).toEqual([])
    })
  })
})
