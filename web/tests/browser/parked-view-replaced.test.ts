import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, type LayoutNode, leaves } from '../../src/layout'
import { parseWorkspace } from '../../src/workspace'
import { copyNames, editorsOf, host, mountAt, mounted, newLambdaViewItem, titleText, until } from './harness'
import { clickToggle } from './user-event-fixture'

/**
 * AN EDIT THAT REPLACES THE ARRANGEMENT A PARKED VIEW IS IN CLOSES THE VIEW — the view layouts spec §4.3 and §5.1.
 *
 * A view is live while the tree on screen or a remembered arrangement holds its leaf, and parked while it is live and
 * off the screen. An edit that changes the combination replaces what the combination it lands in remembered. So a
 * view only that arrangement held is in no tree after the edit: it is closed, its copy's editor goes as a close's
 * does, and the copies menu stops counting it.
 *
 * The case: a second λ view added in source, λ and asm, showing a copy only it shows; the TM toggle, which shows all
 * four and parks it; then `✕` on the TM view. The `✕` leaves source, λ and asm, the arrangement the parked view is in,
 * as all four less the TM view, which has no second λ view.
 *
 * `pane-host.ts`'s `applyLayout` drops a pane off the screen once its id is no longer live as its kind. Without that
 * condition in its keep rule, the copies menu here would go on reading `1 view` for a view nothing could show again.
 * `one-id-two-kinds.test.ts` holds the same close where another arrangement still names the view's id.
 *
 * The toggle, `+ view`, its item and the `✕` are pressed with `userEvent`, as a user presses them; *edit a copy* is
 * `.click()`, since its item is in a menu the case does not open.
 */

const errors: string[] = []
const onError = (e: ErrorEvent): void => {
  errors.push(e.message)
}

const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']
const THREE = 'source+lambda+asm'

/** The ids each stored tree holds, the one on screen under `screen`. */
const storedIds = (): Record<string, string[]> => {
  const ws = parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))
  if (ws === null) throw new Error('the stored workspace does not parse')
  const ids = (tree: LayoutNode): string[] => leaves(tree).map((l) => l.id)
  return {
    screen: ids(ws.tree),
    ...Object.fromEntries(Object.entries(ws.arrangements).map(([key, tree]) => [key, ids(tree)])),
  }
}

beforeAll(async () => {
  window.addEventListener('error', onError)
  await mountAt(1280, 896)
})
afterAll(() => window.removeEventListener('error', onError))

describe('a parked view of a copy, in an arrangement an edit then replaces', () => {
  it('is closed by the edit: the copies menu says its copy is not shown', async () => {
    expect(mounted(), 'precondition: all four views').toEqual(FOUR)

    // SOURCE, λ AND ASM, WITH A SECOND λ VIEW ONLY THIS ARRANGEMENT HOLDS, on a copy only that view shows.
    await clickToggle('tm')
    expect(mounted(), 'precondition: source, λ and asm').toEqual(['source', 'lambda-0', 'asm-0'])
    host('lambda-0')?.querySelector<HTMLElement>('button.view-title')?.focus()
    await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
    await until(() => newLambdaViewItem() !== undefined, '+ view’s λ · program')
    await userEvent.click(newLambdaViewItem() as HTMLButtonElement)
    const second = mounted().find((id) => !FOUR.includes(id))
    if (second === undefined) throw new Error('+ view added no second λ view')
    host(second)?.querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => titleText(second) === 'λ · copy 1' && editorsOf(second) === 1, 'the copy and its editor')
    expect(copyNames(), 'precondition: one view shows the copy').toEqual(['λ copy 1 · 1 view'])

    // ALL FOUR: neither tree on the way names the second λ view but the one left, so it is parked.
    await clickToggle('tm')
    expect(mounted(), 'precondition: all four views, the second λ view off the page').toEqual(FOUR)
    expect(storedIds()[THREE], 'precondition: the arrangement left holds the second λ view').toContain(second)
    expect(copyNames(), 'precondition: the parked view counts as a view of its copy').toEqual(['λ copy 1 · 1 view'])

    // THE ✕ LANDS IN SOURCE, λ AND ASM, and what that combination remembered is replaced by all four less TM.
    await userEvent.click(host('tm-0')?.querySelector<HTMLButtonElement>('button.view-close') as HTMLButtonElement)
    expect(mounted(), 'precondition: the TM view is closed').toEqual(['source', 'lambda-0', 'asm-0'])
    const trees = storedIds()
    expect(Object.keys(trees), 'precondition: source, λ and asm is on screen, and remembered no longer').not.toContain(
      THREE,
    )
    expect(Object.values(trees).flat(), 'precondition: no tree holds the second λ view').not.toContain(second)
    expect(copyNames(), 'a view no tree holds still counts as a view of its copy').toEqual(['λ copy 1 · not shown'])
    expect(errors, 'a handler threw').toEqual([])
  })
})
