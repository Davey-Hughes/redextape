import { expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { armed, controlledMenu, PREFIX, toggle, until, workspaceMenu } from './harness'

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
 * Press `+ view` and pick `label`, with the pointer. The view is added beside the focused view. `what` is the message
 * of the wait for the item.
 */
export async function plusView(label = 'λ · program', what = `+ view's ${label}`): Promise<void> {
  await userEvent.click(document.querySelector('#new-view') as HTMLElement)
  const item = () =>
    [...document.querySelectorAll<HTMLButtonElement>('#new-view-menu button')].find((b) => b.textContent === label)
  await until(() => item() !== undefined, what)
  await userEvent.click(item() as HTMLButtonElement)
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
