import { beforeAll, expect, it } from 'vitest'
import { commands, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { sleep } from './clif-fixture'
import { host, mountAt, until } from './harness'
import {
  codePanelOf,
  codeRows,
  MC_MATCH,
  mcFetched,
  mcRequests,
  sourceAndClif,
  targetChoice,
  twice,
} from './mc-fixture'

/**
 * A pointer resting on the closed machine code panel's toggle fetches the package of the target the panel would show,
 * the view's stored *arm64* here and not the default, and opening it fetches nothing more (machine code panel design
 * §6, *Loading*): `mc-fetch.test.ts`'s doc has why this is a file alone.
 */

const clif = () => host('clif-0') as HTMLElement

beforeAll(async () => {
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    sourceAndClif({ clifDisplay: { 'clif-0': { layout: 'compact', target: 'arm64' } } }),
  )
  await commands.watchRequests('start', MC_MATCH)
  await mountAt(1280, 896)
}, 30_000)

it('fetches the package of the target the panel would show once the pointer rests on its toggle', async () => {
  await until(() => clif().querySelector('.clif-row.is-next') !== null, 'the clif view at its step 0')
  expect(targetChoice(clif(), 'arm64').getAttribute('aria-checked'), 'precondition: arm64 stored').toBe('true')
  expect(codePanelOf(clif()).dataset.open, 'precondition: the panel closed').toBe('false')
  expect(await mcRequests(), 'precondition: nothing fetched before the pointer came').toEqual({
    'x86-64': [],
    arm64: [],
  })
  const toggle = codePanelOf(clif()).querySelector('.panel-toggle') as HTMLElement
  await userEvent.hover(toggle)
  const rested = await mcFetched('arm64')
  await sleep(400)
  expect((await mcRequests())['x86-64'], 'x86-64’s, which the panel would not show').toEqual([])

  await userEvent.click(toggle)
  await until(() => codeRows(clif()).length > 0, 'the panel to show arm64’s rows')
  await sleep(400)
  const opened = await mcRequests()
  expect(opened, 'nothing more fetched by opening it').toEqual(rested)
  expect(twice(opened.arm64), 'a request made twice').toEqual([])
})
