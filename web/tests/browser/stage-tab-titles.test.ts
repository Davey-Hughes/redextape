import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * IN STAGE, A TAB NAMES WHAT ITS VIEW SHOWS, AS THE VIEW'S TITLE DOES (Plan 7 part 2 spec §5, §7).
 *
 * *Edit a copy*, a pick in the title's menu and a move back to the program each rebind a view in place. The view's
 * title changed on the frame the rebind drew, but its tab was built by `renderStage` and kept its old label until
 * another tab was selected — on every leg (the check by hand's finding 2). `draw()` now brings every tab up to its
 * view's title once per frame (`layout-view.ts`'s `retitleStage`), so each gesture below reads the tab against the
 * title as soon as the title has changed.
 *
 * Every gesture is a `userEvent` one. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

const SAMPLE = 'let x = 40; x + 2'

const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const host = (leaf: string) => document.querySelector<HTMLElement>(`.pane[data-leaf="${leaf}"]`) as HTMLElement
const tab = (leaf: string) =>
  document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`) as HTMLElement
const titleButton = (leaf: string) =>
  host(leaf).querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
const title = (leaf: string) => titleButton(leaf).textContent?.trim() ?? ''
const label = (leaf: string) => tab(leaf).textContent ?? ''
const menuOf = (button: HTMLElement): HTMLElement =>
  document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement

/** Pick from the workspace menu with the pointer, and close it if the pick left it open. */
async function workspace(selector: string): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>('#workspace') as HTMLButtonElement
  await userEvent.click(button)
  await userEvent.click(document.querySelector<HTMLElement>(`#workspace-menu ${selector}`) as HTMLElement)
  if (menuOf(button).matches(':popover-open')) await userEvent.keyboard('{Escape}')
}

/** Select `leaf`'s tab with the pointer, and wait for its view to be the one on the page. */
async function show(leaf: string): Promise<void> {
  await userEvent.click(tab(leaf))
  await until(() => host(leaf).isConnected, `${leaf}’s view on the stage`)
}

/** *Edit a copy* through the view's `⋯` menu, with the pointer. */
async function editACopy(leaf: string): Promise<void> {
  const more = host(leaf).querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
  await userEvent.click(more)
  await until(() => menuOf(more).matches(':popover-open'), 'the view menu to open')
  await userEvent.click(menuOf(more).querySelector<HTMLButtonElement>('button.detach') as HTMLButtonElement)
}

/** Pick, in `leaf`'s title menu, the first pair `which` accepts, with the pointer; returns the label picked. */
async function pickTitle(leaf: string, which: (b: HTMLButtonElement) => boolean): Promise<string> {
  await userEvent.click(titleButton(leaf))
  const menu = menuOf(titleButton(leaf))
  await until(() => menu.matches(':popover-open'), 'the title’s menu to open')
  const item = [...menu.querySelectorAll<HTMLButtonElement>('button[data-binding]')].find(which)
  if (item === undefined) throw new Error(`${leaf}’s title offers no such pair`)
  const picked = item.textContent ?? ''
  await userEvent.click(item)
  return picked
}

/** Wait for `leaf`'s title to leave `before`, then read the tab against it at once. */
async function tabFollows(leaf: string, before: string, gesture: string): Promise<void> {
  await until(() => title(leaf) !== before, `${gesture} to change the title`)
  expect(label(leaf), `the tab after ${gesture}`).toBe(title(leaf))
}

beforeAll(async () => {
  await page.viewport(1280, 1000)
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SAMPLE } })
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
  await workspace('[data-switch="views"][data-value="stage"]')
  await until(() => tab('asm-0') !== null, 'the stage’s tabs')
})

describe('a Stage tab', () => {
  it('follows its asm view through edit a copy, a pick of another copy, and back to the program', async () => {
    // A SECOND ASM COPY, FOR THE TITLE TO PICK: a blank one from the copies menu, which no view shows.
    await userEvent.click(document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement)
    await userEvent.click(document.querySelector<HTMLButtonElement>('.buffer-list button.new-asm') as HTMLElement)
    await until(() => document.querySelector('#notice .notice-text')?.textContent?.endsWith('created') === true)

    await show('asm-0')
    expect(label('asm-0')).toBe('asm · program')
    expect(title('asm-0')).toBe('asm · program')

    await editACopy('asm-0')
    await tabFollows('asm-0', 'asm · program', 'edit a copy')
    expect(label('asm-0')).toMatch(/^asm · copy \d+$/)

    const made = title('asm-0')
    const picked = await pickTitle(
      'asm-0',
      (b) =>
        b.dataset.binding?.startsWith('asm:') === true && b.textContent !== made && b.dataset.binding !== 'asm:source',
    )
    await tabFollows('asm-0', made, 'a pick of another copy')
    expect(label('asm-0')).toBe(picked)

    await pickTitle('asm-0', (b) => b.dataset.binding === 'asm:source')
    await tabFollows('asm-0', picked, 'a move back to the program')
    expect(label('asm-0')).toBe('asm · program')
  })

  it('follows its TM and λ views through edit a copy, a pick of another copy, and back to the program', async () => {
    for (const [leaf, leg, program] of [
      ['tm-0', 'tm', 'TM · program'],
      ['lambda-0', 'lambda', 'λ · program'],
    ] as const) {
      await show(leaf)
      expect(label(leaf)).toBe(program)
      await editACopy(leaf)
      await tabFollows(leaf, program, `${leg}’s edit a copy`)
      const first = title(leaf)

      // A FIRST COPY, LEFT BEHIND ON THE MOVE BACK TO THE PROGRAM: neither leg has a *new blank copy*
      // button of asm's own kind — a TM copy is one, but a λ copy is always made from a step of the
      // program (`buffer-list.ts`'s `BLANK_COPY`) — so a second fork is what gives the title menu
      // another copy to pick, the way the asm test's blank one does.
      await pickTitle(leaf, (b) => b.dataset.binding === `${leg}:source`)
      await tabFollows(leaf, first, `${leg}’s move back to the program`)
      expect(label(leaf)).toBe(program)

      await editACopy(leaf)
      await tabFollows(leaf, program, `${leg}’s second edit a copy`)
      const second = title(leaf)
      expect(second, 'the two copies must differ for a pick to show anything').not.toBe(first)

      const picked = await pickTitle(
        leaf,
        (b) =>
          b.dataset.binding?.startsWith(`${leg}:`) === true &&
          b.textContent !== second &&
          b.dataset.binding !== `${leg}:source`,
      )
      await tabFollows(leaf, second, `${leg}’s pick of another copy`)
      expect(label(leaf)).toBe(picked)

      await pickTitle(leaf, (b) => b.dataset.binding === `${leg}:source`)
      await tabFollows(leaf, picked, `${leg}’s move back to the program`)
      expect(label(leaf)).toBe(program)
    }
  })
})
