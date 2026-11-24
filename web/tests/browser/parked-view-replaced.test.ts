import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, type LayoutNode, leaves } from '../../src/layout'
import { parseWorkspace } from '../../src/workspace'
import { host, mountAt, mounted } from './harness'
import { clickToggle, userSplit } from './user-event-fixture'

/**
 * AN EDIT THAT REPLACES THE ARRANGEMENT A PARKED VIEW IS IN CLOSES THE VIEW — the view layouts spec §4.3 and §5.1.
 *
 * A view is live while the tree on screen or a remembered arrangement holds its leaf, and parked while it is live and
 * off the screen. An edit that changes the combination replaces what the combination it lands in remembered. So a
 * view only that arrangement held is in no tree after the edit: it is closed, and a view built later under its id is
 * a new one.
 *
 * The case: a λ view under `lambda-0` that only source, λ and rxm holds, the λ view of all four being one split off
 * `lambda-0` before it was closed; the TM toggle parks it; `✕` on the TM view leaves source, λ and rxm as all four
 * less TM; the rxm toggle's first visit of the source beside λ builds its default's λ view under `lambda-0`.
 *
 * `pane-host.ts`'s `applyLayout` drops a pane off the screen once its id is no longer live as its kind; without that
 * condition the closed view would come back there. `one-id-two-kinds.test.ts` holds the edit where another
 * arrangement still names the id as another kind. Toggles, split and `✕` are pressed with `userEvent`.
 */

const errors: string[] = []
const onError = (e: ErrorEvent): void => {
  errors.push(e.message)
}

const THREE = 'source+lambda+rxm'

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
const close = (leaf: string): Promise<void> =>
  userEvent.click(host(leaf)?.querySelector<HTMLButtonElement>('button.view-close') as HTMLButtonElement)

beforeAll(async () => {
  window.addEventListener('error', onError)
  await mountAt(1280, 896)
})
afterAll(() => window.removeEventListener('error', onError))

describe('a parked view, in the one arrangement an edit then replaces', () => {
  it('is closed by the edit: a view built later under its id is a new one', async () => {
    expect(mounted(), 'precondition: all four views').toEqual(['source', 'lambda-0', 'rxm-0', 'tm-0'])

    // ALL FOUR WITH ITS λ VIEW SPLIT OFF `lambda-0`, AND `lambda-0` CLOSED: no tree names `lambda-0` then.
    const second = await userSplit('lambda-0', 'same')
    if (second === null) throw new Error('the split added no second λ view')
    await close('lambda-0')
    expect(mounted(), 'precondition: all four, the λ view the split added').toEqual(['source', second, 'rxm-0', 'tm-0'])

    // SOURCE, λ AND RXM, VISITED FIRST, SO ITS DEFAULT: its λ view is built under `lambda-0`.
    await clickToggle('tm')
    expect(mounted(), 'precondition: the default of source, λ and rxm').toEqual(['source', 'lambda-0', 'rxm-0'])
    const parked = host('lambda-0')?.firstElementChild
    if (parked === null || parked === undefined) throw new Error('the λ view has no element to recognise it by')

    // ALL FOUR, AS IT WAS LEFT: the λ view under `lambda-0` is parked, in the one arrangement that holds it.
    await clickToggle('tm')
    expect(mounted(), 'precondition: all four views, lambda-0 off the page').toEqual([
      'source',
      second,
      'rxm-0',
      'tm-0',
    ])
    const before = storedIds()
    expect(before[THREE], 'precondition: the arrangement left holds the λ view').toContain('lambda-0')
    expect(
      Object.entries(before).filter(([key, ids]) => key !== THREE && ids.includes('lambda-0')),
      'precondition: no other tree holds the λ view',
    ).toEqual([])

    // THE ✕ LANDS IN SOURCE, λ AND RXM, and what that combination remembered is replaced by all four less TM.
    await close('tm-0')
    expect(mounted(), 'precondition: the TM view is closed').toEqual(['source', second, 'rxm-0'])
    expect(Object.values(storedIds()).flat(), 'precondition: no tree holds the λ view').not.toContain('lambda-0')

    // THE SOURCE BESIDE λ, VISITED FIRST: its default names `lambda-0`, and the view built there is a new one.
    await clickToggle('rxm')
    expect(mounted(), 'precondition: the default of the source beside λ').toEqual(['source', 'lambda-0'])
    expect(host('lambda-0')?.firstElementChild, 'the closed view came back under its id').not.toBe(parked)
    expect(errors, 'a handler threw').toEqual([])
  })
})
