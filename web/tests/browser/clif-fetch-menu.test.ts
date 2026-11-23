import { beforeAll, expect, it } from 'vitest'
import { commands, userEvent } from 'vitest/browser'
import { CLIF_MATCH, clifFetched, clifRequests } from './clif-fixture'
import { mountAt, toggle } from './harness'

/**
 * A pointer resting on the CLIF toggle in the workspace menu, where a narrow window puts the toggles, fetches
 * `pkg-clif`, as it does on the toggle in the header (`clif-fetch-rest.test.ts`): the same button carries the same
 * listener wherever it is. `clif-fetch.test.ts`'s doc has why this is a file alone.
 */

beforeAll(async () => {
  await commands.watchRequests('start', CLIF_MATCH)
  await mountAt(600, 896)
}, 30_000)

it('fetches once the pointer rests on the CLIF toggle in the workspace menu', async () => {
  expect(await clifRequests(), 'precondition: nothing fetched before the pointer came').toEqual([])
  const menu = document.querySelector('#workspace-menu') as HTMLElement
  await userEvent.click(document.querySelector('#workspace') as HTMLElement)
  expect(menu.matches(':popover-open'), 'precondition: the workspace menu is open').toBe(true)
  expect(menu.contains(toggle('clif')), 'precondition: the CLIF toggle is in the workspace menu').toBe(true)
  expect(await clifRequests(), 'precondition: opening the menu fetched nothing').toEqual([])
  await userEvent.hover(toggle('clif'))
  expect(await clifFetched()).not.toEqual([])
})
