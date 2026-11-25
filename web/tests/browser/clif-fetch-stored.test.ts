import { afterAll, beforeAll, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, type LayoutNode } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { CLIF_MATCH, clifFetched, hearSessionWorkers, requestsOf } from './clif-fixture'
import { mountAt, mounted } from './harness'

/**
 * A stored workspace that shows a CLIF view fetches `pkg-clif` at start, through the first run, which carries the
 * listing: `clif-fetch.test.ts`'s doc has why this is a file alone.
 */

/** The source beside a CLIF view. */
const SOURCE_AND_CLIF: LayoutNode = {
  kind: 'split',
  dir: 'row',
  sizes: [0.5, 0.5],
  children: [
    { kind: 'leaf', id: 'source', pane: 'source' },
    { kind: 'leaf', id: 'clif-0', pane: 'clif' },
  ],
}

let ear: ReturnType<typeof hearSessionWorkers>

beforeAll(async () => {
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({ ...defaultWorkspace('wide'), tree: SOURCE_AND_CLIF, focused: 'source' }),
  )
  ear = hearSessionWorkers()
  await commands.watchRequests('start', CLIF_MATCH)
  await mountAt(1280, 896)
}, 30_000)

afterAll(() => ear.restore())

it('fetches at start for a stored workspace showing CLIF', async () => {
  expect(mounted(), 'precondition: the stored workspace').toEqual(['source', 'clif-0'])
  const [first] = requestsOf(ear.heard, 'run')
  expect(first?.clif, 'the listing the first run carries').toBe('as-built')
  expect(
    requestsOf(ear.heard, 'clif-load'),
    "precondition: the page asked for no clif load, so a fetch is the run's",
  ).toEqual([])
  expect(await clifFetched()).not.toEqual([])
})
