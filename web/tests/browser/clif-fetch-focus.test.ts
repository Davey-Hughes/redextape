import { beforeAll, expect, it } from 'vitest'
import { commands, userEvent } from 'vitest/browser'
import { CLIF_MATCH, clifFetched, clifRequests } from './clif-fixture'
import { mountAt, toggle } from './harness'

/**
 * The CLIF toggle taking the focus fetches `pkg-clif` at once: `clif-fetch.test.ts`'s doc has why this is a file
 * alone. **THE TABS START ON THE λ TOGGLE**, before CLIF's in the header, so that the focus reaches it by Tab, as a
 * keyboard user's does.
 */

/** The most presses of Tab the walk from the λ toggle may take. */
const MOST_TABS = 8

beforeAll(async () => {
  await commands.watchRequests('start', CLIF_MATCH)
  await mountAt(1280, 896)
}, 30_000)

it('fetches when the toggle takes focus', async () => {
  expect(await clifRequests(), 'precondition: nothing fetched before the focus came').toEqual([])
  toggle('lambda').focus()
  for (let tabs = 0; tabs < MOST_TABS && document.activeElement !== toggle('clif'); tabs += 1) await userEvent.tab()
  expect(document.activeElement, 'precondition: Tab reached the CLIF toggle').toBe(toggle('clif'))
  expect(await clifFetched()).not.toEqual([])
})
