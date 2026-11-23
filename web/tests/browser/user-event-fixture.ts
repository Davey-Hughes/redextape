import { expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { armed, controlledMenu, mounted, PREFIX, toggle, until, workspaceMenu } from './harness'

/**
 * Browser-tier helpers that act through `vitest/browser`'s `userEvent` and are imported at the top of the file. They
 * are kept out of `harness.ts`, which imports `vitest/browser` only when a helper is called, for the reason its
 * `chooseSetting` gives.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names end in
 * `.test.ts`, and this one does not.
 */

/**
 * The prefix and then `key`, with the mode asserted armed between them; `unarmed` is the message where the prefix did
 * not arm it.
 */
export async function viewKey(key: string, unarmed = 'the prefix did not arm the mode'): Promise<void> {
  await userEvent.keyboard(PREFIX)
  expect(armed(), unarmed).toBe(true)
  await userEvent.keyboard(key)
  expect(armed()).toBe(false)
}

/** Choose the item `sel` from the workspace menu with the pointer, and close the menu where it is still open. */
export const userPickWorkspace = async (sel: string): Promise<void> => {
  await userEvent.click(document.querySelector('#workspace') as HTMLElement)
  await userEvent.click(document.querySelector(`#workspace-menu ${sel}`) as HTMLElement)
  const menu = document.querySelector<HTMLElement>('#workspace-menu')
  if (menu?.matches(':popover-open')) menu.hidePopover()
}

/**
 * Split `leaf` through its `⋯` menu with the pointer: `dir` is the direction, and `pick` the pair, `'same'` (another
 * view of this), `'source'`, or a `bindingKey(leg, session)`. It answers the id of the view the split made, or `null`
 * where it made none, a split refused.
 *
 * **IT THROWS WHERE THE MENU OFFERS NO `pick`, NAMING THE PAIRS IT OFFERS**: a click on an item that is not there is
 * no gesture, and every assertion after it would describe a page nothing happened on (`splitVia`'s doc).
 */
export async function userSplit(leaf: string, pick: string, dir: 'row' | 'column' = 'row'): Promise<string | null> {
  const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
  if (more === null) throw new Error(`no view menu on [data-leaf="${leaf}"]`)
  const before = new Set(mounted())
  await userEvent.click(more)
  const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement
  await until(() => menu.matches(':popover-open'), `${leaf}'s view menu`)
  await userEvent.click(menu.querySelector(`button.view-split[data-dir="${dir}"]`) as HTMLButtonElement)
  const pairs = () => [...menu.querySelectorAll<HTMLButtonElement>('.view-menu-pairs button')]
  await until(() => pairs().length > 0, `${leaf}'s split pairs`)
  const which = pick === 'same' ? '[data-same]' : pick === 'source' ? '[data-source]' : `[data-binding="${pick}"]`
  const item = menu.querySelector<HTMLButtonElement>(`.view-menu-pairs button${which}`)
  if (item === null) {
    const offered = pairs().map((b) => b.textContent)
    throw new Error(`[data-leaf="${leaf}"] offers no ${pick} to split into — offered: ${offered.join(' | ')}`)
  }
  await userEvent.click(item)
  // THE PICK SHUTS THE MENU BEFORE IT SPLITS, so a shut menu says the click reached the item.
  await until(() => !menu.matches(':popover-open'), `${leaf}'s split of ${pick}`)
  return mounted().find((id) => !before.has(id)) ?? null
}

/** A click with the pointer on the toggle that shows and hides the `kind` views. */
export const clickToggle = (kind: string): Promise<void> => userEvent.click(toggle(kind))

/** Open the workspace menu with the pointer and press its item `sel`; a preset or a switch leaves the menu open. */
export const userPickInWorkspaceMenu = async (sel: string): Promise<void> => {
  await userEvent.click(document.querySelector('#workspace') as HTMLElement)
  await userEvent.click(workspaceMenu().querySelector(sel) as HTMLElement)
  if (workspaceMenu().matches(':popover-open')) workspaceMenu().hidePopover()
}

/** Whether the workspace menu, opened, holds *reset preset*. */
export const resetOffered = async (): Promise<boolean> => {
  await userEvent.click(document.querySelector('#workspace') as HTMLElement)
  const offered = workspaceMenu().matches(':popover-open') && workspaceMenu().querySelector('#reset-preset') !== null
  workspaceMenu().hidePopover()
  return offered
}

/** Pick from the workspace menu with the pointer, and close it if the pick left it open. */
export async function chooseFromWorkspace(selector: string): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>('#workspace') as HTMLButtonElement
  await userEvent.click(button)
  await userEvent.click(document.querySelector<HTMLElement>(`#workspace-menu ${selector}`) as HTMLElement)
  if (controlledMenu(button).matches(':popover-open')) await userEvent.keyboard('{Escape}')
}
