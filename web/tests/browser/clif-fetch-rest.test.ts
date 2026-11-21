import { beforeAll, expect, it } from 'vitest'
import { commands, userEvent } from 'vitest/browser'
import { CLIF_MATCH, clifFetched, clifRequests } from './clif-fixture'
import { mountAt, mounted, toggle } from './harness'

/** A pointer resting on the CLIF toggle fetches `pkg-clif`: `clif-fetch.test.ts`'s doc has why this is a file alone. */

beforeAll(async () => {
  await commands.watchRequests('start', CLIF_MATCH)
  await mountAt(1280, 896)
}, 30_000)

it('fetches once the pointer rests on the CLIF toggle', async () => {
  expect(mounted().sort(), 'precondition: the four views').toEqual(['lambda-0', 'rxm-0', 'source', 'tm-0'])
  expect(await clifRequests(), 'precondition: nothing fetched before the pointer came').toEqual([])
  await userEvent.hover(toggle('clif'))
  expect(await clifFetched()).not.toEqual([])
})
