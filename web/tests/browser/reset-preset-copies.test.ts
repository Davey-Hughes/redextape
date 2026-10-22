import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { controlledMenu, linkStatus, noticeText, paneByLeaf, SHELL, stateIdle, until } from './harness'

/**
 * *RESET PRESET* RESTORES THE DEFAULT VIEWS, AND A DEFAULT VIEW SHOWS THE PROGRAM (Plan 7 part 2 spec §4, §6).
 *
 * A default tree re-mints its views' ids, and `applyLayout` would keep a pane whose id and kind survived, binding and
 * all: *reset preset* would say "Explorer reset — the default views are back" over views still on their copies.
 * `pane-host.ts`'s `resetViews` rebuilds each such view on the program, as a fresh preset's are, and the copies stay:
 * in the copies menu, and with their editors when a view shows them again.
 *
 * **THE DEFAULT IS THE SOURCE BESIDE THE TM VIEW** (the view layouts spec §8), so the reset keeps one of the three
 * views, `tm-0`, and that is the one a kept binding would show. The λ and asm views leave the page with the reset and
 * every remembered arrangement is forgotten, so the views their toggles bring back are new ones.
 *
 * Every gesture is a `userEvent` one. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

const SAMPLE = 'let x = 40; x + 2'
const LEAVES = ['lambda-0', 'asm-0', 'tm-0'] as const
const LEG: Record<(typeof LEAVES)[number], string> = { 'lambda-0': 'lambda', 'asm-0': 'asm', 'tm-0': 'tm' }

const title = (leaf: string) => paneByLeaf(leaf).querySelector('button.view-title')?.textContent?.trim() ?? ''

beforeAll(async () => {
  await page.viewport(1280, 1000)
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SAMPLE } })
  await until(() => !stateIdle(), 'the compile to start')
  await until(stateIdle, 'the compile to finish')
})

describe('reset preset', () => {
  it('puts every view back on the program, and says so truly', async () => {
    for (const leaf of LEAVES) {
      const more = paneByLeaf(leaf).querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
      await userEvent.click(more)
      await until(() => controlledMenu(more).matches(':popover-open'), `${leaf}’s menu to open`)
      await userEvent.click(controlledMenu(more).querySelector<HTMLButtonElement>('button.detach') as HTMLButtonElement)
      await until(() => / · copy \d+$/.test(title(leaf)), `${leaf} to show its copy`)
      // THE FORK'S BUILD REPLY, NOT JUST ITS TITLE: `detach` rebinds the slot (and so the title)
      // synchronously, before the worker answers, but the copy's editor only mounts once
      // `scratch-compiled` (or its TM/asm twin) lands (`replies.ts`). Racing `reset preset` ahead of
      // that reply finds `LambdaPane.takeEditor()` empty, so `applyLayout`'s pass 1 has nothing to
      // hand to custody — `editor-custody.ts`'s `dropClaimsOn` then erases the claim the late reply
      // needed, and the copy's editor mounts FRESH on the next pick instead of waiting in custody for
      // *move the editor here*, which is the failure this wait keeps out of reach.
      await until(() => paneByLeaf(leaf).querySelector('.cm-editor') !== null, `${leaf}’s copy’s editor to mount`)
    }
    // THE PRECONDITION: a view of every leg shows a copy.
    expect(LEAVES.map((leaf) => paneByLeaf(leaf).querySelector('.view-status') !== null)).toEqual([true, true, true])
    expect(linkStatus()).toContain('views show copies')

    await userEvent.click(document.querySelector<HTMLButtonElement>('#workspace') as HTMLButtonElement)
    await userEvent.click(document.querySelector<HTMLButtonElement>('#reset-preset') as HTMLButtonElement)

    expect(noticeText()).toBe('Explorer reset — the default views are back')
    expect([...document.querySelectorAll<HTMLElement>('.pane[data-leaf]')].map((el) => el.dataset.leaf)).toEqual([
      'source',
      'tm-0',
    ])
    expect(title('tm-0'), 'the view the reset kept is still on its copy').toBe('TM · program')
    expect(document.querySelectorAll('.pane .view-status')).toHaveLength(0)
    expect(linkStatus()).not.toContain('copy')

    // AND THE TWO VIEWS THE RESET TOOK OFF THE PAGE COME BACK ON THE PROGRAM, as new views: nothing remembers them.
    for (const kind of ['lambda', 'asm'])
      await userEvent.click(document.querySelector(`#views-shown button[data-shows="${kind}"]`) as HTMLElement)
    expect(LEAVES.map(title)).toEqual(['λ · program', 'asm · program', 'TM · program'])
    expect(document.querySelectorAll('.pane .view-status')).toHaveLength(0)
    expect(linkStatus()).not.toContain('copy')
  })

  it('keeps the copies, each with its text when a view shows it again', async () => {
    const buffers = document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement
    await userEvent.click(buffers)
    const rows = [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row-name')].map((r) => r.textContent)
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row).toMatch(/ · not shown$/)
    await userEvent.keyboard('{Escape}')

    // EACH COPY IS PICKED AGAIN THROUGH ITS VIEW'S TITLE, AND ITS EDITOR COMES BACK WITH IT: the machine copies' is
    // mounted again from their text, and the λ copy's waited in custody, as after a close, for *move the editor here*.
    for (const leaf of LEAVES) {
      const button = paneByLeaf(leaf).querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
      await userEvent.click(button)
      const menu = controlledMenu(button)
      await until(() => menu.matches(':popover-open'), `${leaf}’s title menu`)
      const item = [...menu.querySelectorAll<HTMLButtonElement>('button[data-binding]')].find(
        (b) => b.dataset.binding?.startsWith(`${LEG[leaf]}:`) === true && / · copy \d+$/.test(b.textContent ?? ''),
      )
      await userEvent.click(item as HTMLButtonElement)
      if (leaf === 'lambda-0') {
        const more = paneByLeaf(leaf).querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
        await userEvent.click(more)
        await until(() => controlledMenu(more).matches(':popover-open'), 'the λ view’s menu')
        await userEvent.click(
          controlledMenu(more).querySelector<HTMLButtonElement>('button.claim-editor') as HTMLButtonElement,
        )
      }
      await until(() => paneByLeaf(leaf).querySelector('.cm-editor') !== null, `${leaf}’s copy’s editor`)
      expect(title(leaf)).toMatch(/ · copy \d+$/)
    }
  })
})
