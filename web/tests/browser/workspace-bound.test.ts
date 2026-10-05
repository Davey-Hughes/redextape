import { beforeAll, describe, expect, it } from 'vitest'
import { defaultLayout, insertBeside, LAYOUT_STORAGE_KEY, type LayoutNode } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A STORED LAYOUT PAST THE BOUND ON A TREE LOADS AS THE DEFAULT** — Plan 7 part 6a spec §5.3, amended 2026-10-01: at
 * most 64 splits deep and 64 leaves, held alike for a link's tree and a stored one. Before the bound, a stored tree
 * deep enough stopped every later load of the app until the site's data was cleared.
 *
 * The tree stored is the one `insertBeside` builds when called 61 times in a row from the default, each beside the
 * view the last one added: 65 leaves, 63 of them in one row, 2 splits deep, so it is past the leaf bound and not the
 * depth bound. **THE APP NEVER WROTE THIS TREE.** Until 2026-10-04 `+ view` nested each view a split deeper, so its
 * 61st press stored a 65-leaf tree 63 splits deep, which a user lost at the next load; since then `layout.ts`'s
 * `holdsMostLeaves` refuses that press. A 65-leaf tree in storage now comes from that older app, or from a hand.
 * ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

function pressed(presses: number): LayoutNode {
  let tree = defaultLayout()
  let focused = 'lambda-0'
  for (let k = 1; k <= presses; k++) {
    tree = insertBeside(tree, focused, 'row', `pane-${k}`, 'lambda')
    focused = `pane-${k}`
  }
  return tree
}

const leafIds = () => [...document.querySelectorAll<HTMLElement>('main [data-leaf]')].map((el) => el.dataset.leaf ?? '')

beforeAll(async () => {
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({ ...defaultWorkspace(), tree: pressed(61), focused: 'pane-61' }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('a stored layout with 65 leaves', () => {
  it('loads the default views instead', () => {
    expect(leafIds()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
  })
})
