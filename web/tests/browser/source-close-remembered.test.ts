import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { parseWorkspace, type Workspace } from '../../src/workspace'
import { drawn, SHELL, until } from './harness'

/**
 * THE SOURCE VIEW'S OWN `✕` IS A WRITE OF THE TREE LIKE ANY OTHER — the view layouts spec §4.3: it goes through
 * `arrangements.ts`'s `enter`, so the tree it leaves is remembered under its combination and the source toggle
 * brings that tree back.
 *
 * **IT IS `main.ts`'S OWN HANDLER, AND NOT `pane-host.ts`'S `close`**: the source view has no pane entry, so its
 * `✕` is wired where its header is built, and calls `enterTree` itself. With a bare assignment of the tree there,
 * every browser file passed but one that pressed the source toggle after it for another reason.
 *
 * **THE COMBINATION THE `✕` LEAVES HAS BEEN VISITED BEFORE, SO THE WORKSPACE REMEMBERS AN ARRANGEMENT FOR IT.**
 * `enter` drops that entry as it puts the combination on screen. Left there, the stored workspace holds an
 * arrangement under the key of the tree on screen, which `parseWorkspace` refuses, and the next load opens on the
 * default workspace.
 */

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.removeItem(LAYOUT_STORAGE_KEY)

const host = (leaf: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${leaf}"]:not([role="tab"])`) as HTMLElement
const toggle = (kind: string): HTMLButtonElement =>
  document.querySelector(`#views-shown button[data-shows="${kind}"]`) as HTMLButtonElement
/** The stored workspace, parsed as a load would parse it: a throw where the loader would refuse it. */
const stored = (when: string): Workspace => {
  const ws = parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))
  if (ws === null) throw new Error(`${when}: the stored workspace does not parse`)
  return ws
}
/** The combinations the stored workspace remembers an arrangement for. */
const remembered = (when: string): string[] => Object.keys(stored(when).arrangements).sort()

describe('the source view’s own ✕', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
    expect(drawn(), 'precondition: the page opened on the first load’s views').toBe('row[50](source tm-0)')
  })

  it('remembers the tree it leaves, drops the one it enters, and its toggle brings the tree back', async () => {
    // A THIRD VIEW, SO THE TREE THE `✕` LEAVES IS NOT ITS COMBINATION'S DEFAULT: the toggle could build that from
    // nothing.
    await userEvent.click(document.querySelector('#new-view') as HTMLElement)
    const item = [...document.querySelectorAll<HTMLButtonElement>('#new-view-menu button')].find(
      (b) => b.textContent === 'λ · program',
    )
    if (item === undefined) throw new Error('+ view offers no λ · program')
    await userEvent.click(item)
    const before = drawn()
    expect(before).toBe('row[33 33](source tm-0 pane-1)')
    expect(remembered('after + view')).toEqual(['source+tm'])

    // THE COMBINATION WITHOUT THE SOURCE VIEW IS VISITED AND LEFT, so the workspace remembers an arrangement for it.
    await userEvent.click(toggle('source'))
    await userEvent.click(toggle('source'))
    expect(drawn(), 'precondition: the toggle, off and on, left the tree as it was').toBe(before)
    expect(remembered('precondition')).toEqual(['lambda+tm', 'source+tm'])
    const tree = stored('before the ✕').tree

    await userEvent.click(host('source').querySelector('button.view-close') as HTMLElement)
    expect(drawn()).toBe('row[50](tm-0 pane-1)')
    const after = stored('after the ✕')
    expect(Object.keys(after.arrangements).sort(), 'the ✕ did not go through enter').toEqual([
      'source+lambda+tm',
      'source+tm',
    ])
    expect(after.arrangements['source+lambda+tm'], 'the tree the ✕ left is not the one remembered').toEqual(tree)

    await userEvent.click(toggle('source'))
    expect(drawn(), 'the source toggle did not bring back the tree the ✕ left').toBe(before)
    expect(remembered('after the toggle')).toEqual(['lambda+tm', 'source+tm'])
  })
})
