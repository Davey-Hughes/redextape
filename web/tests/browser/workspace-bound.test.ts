import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { serializeWorkspace } from '../../src/workspace'
import { fourViewWorkspace, mainLeafIds, pressedLayout, SHELL, stateIdle, until } from './harness'

/**
 * **A STORED LAYOUT PAST THE BOUND ON A TREE LOADS AS THE DEFAULT** — Plan 7 part 6a spec §5.3, amended 2026-10-01: at
 * most 64 splits deep and 64 leaves, held alike for a link's tree and a stored one. Without the bound, a stored tree
 * deep enough would stop every later load of the app until the site's data was cleared.
 *
 * The tree stored is the one `insertBeside` builds when called 61 times in a row from `fourViews()`, each beside the
 * view the last one added: 65 leaves, 63 of them in one row, 2 splits deep, so it is past the leaf bound and not the
 * depth bound. **THE APP DOES NOT WRITE THIS TREE**: `pane-host.ts`'s `admit` refuses a 65th live view, so a 65-leaf
 * tree in storage comes from an older app or from a hand. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

beforeAll(async () => {
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({ ...fourViewWorkspace(), tree: pressedLayout(61), focused: 'pane-61' }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
})

describe('a stored layout with 65 leaves', () => {
  it('loads the default views instead', () => {
    expect(mainLeafIds()).toEqual(['source', 'tm-0'])
  })
})
