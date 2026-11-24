import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { controlledMenu, paneByLeaf, SHELL, stageTab, stateIdle, until } from './harness'
import { chooseFromWorkspace } from './user-event-fixture'

/**
 * IN STAGE, A TAB NAMES WHAT ITS VIEW SHOWS, AS THE VIEW'S TITLE DOES (Plan 7 part 2 spec §5, §7).
 *
 * A pick of another kind's pair in a view's title, and a pick back, change what the view shows under its own leaf. Each
 * rebuilds the view, and the stage is drawn again with it (`layout-view.ts`'s `renderStage`), its tab named from the
 * view's binding (`main.ts`'s `viewTitle`); a tab named by anything else, its leaf's id among them, would go on
 * naming the kind the view was before. So each gesture below reads the tab against the title as soon as the title has
 * changed.
 *
 * Every gesture is a `userEvent` one. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

const SAMPLE = 'let x = 40; x + 2'

const titleButton = (leaf: string) =>
  paneByLeaf(leaf).querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
const title = (leaf: string) => titleButton(leaf).textContent?.trim() ?? ''
const label = (leaf: string) => stageTab(leaf).textContent ?? ''

/** Select `leaf`'s tab with the pointer, and wait for its view to be the one on the page. */
async function show(leaf: string): Promise<void> {
  await userEvent.click(stageTab(leaf))
  await until(() => paneByLeaf(leaf).isConnected, `${leaf}’s view on the stage`)
}

/** Pick, in `leaf`'s title menu, the first pair `which` accepts, with the pointer; returns the label picked. */
async function pickTitle(leaf: string, which: (b: HTMLButtonElement) => boolean): Promise<string> {
  await userEvent.click(titleButton(leaf))
  const menu = controlledMenu(titleButton(leaf))
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
  await until(() => !stateIdle(), 'the compile to start')
  await until(stateIdle, 'the compile to finish')
  await chooseFromWorkspace('[data-switch="views"][data-value="stage"]')
  await until(() => stageTab('rxm-0') !== null, 'the stage’s tabs')
})

describe('a Stage tab', () => {
  it('follows its rxm view through a pick of the TM view’s pair, and a pick back', async () => {
    await show('rxm-0')
    expect(label('rxm-0')).toBe('rxm · program')
    expect(title('rxm-0')).toBe('rxm · program')

    const picked = await pickTitle('rxm-0', (b) => b.dataset.binding === 'tm:source')
    await tabFollows('rxm-0', 'rxm · program', 'a pick of TM · program')
    expect(label('rxm-0')).toBe(picked)
    expect(picked).toBe('TM · program')

    await pickTitle('rxm-0', (b) => b.dataset.binding === 'rxm:source')
    await tabFollows('rxm-0', picked, 'a pick back of rxm · program')
    expect(label('rxm-0')).toBe('rxm · program')
  })

  it('follows its TM and λ views through a pick of another kind’s pair, and a pick back', async () => {
    for (const [leaf, leg, program, other] of [
      ['tm-0', 'tm', 'TM · program', 'rxm'],
      ['lambda-0', 'lambda', 'λ · program', 'tm'],
    ] as const) {
      await show(leaf)
      expect(label(leaf)).toBe(program)

      const picked = await pickTitle(leaf, (b) => b.dataset.binding === `${other}:source`)
      await tabFollows(leaf, program, `${leg}’s pick of ${other}’s pair`)
      expect(label(leaf)).toBe(picked)

      await pickTitle(leaf, (b) => b.dataset.binding === `${leg}:source`)
      await tabFollows(leaf, picked, `${leg}’s pick back`)
      expect(label(leaf)).toBe(program)
    }
  })
})
