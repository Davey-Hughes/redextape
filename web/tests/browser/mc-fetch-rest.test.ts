import { beforeAll, expect, it } from 'vitest'
import { commands, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { sleep } from './clif-fixture'
import { host, mountAt, mounted, pageCentreOf, until } from './harness'
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
 * A stored clif view whose machine code panel is closed fetches neither package at start or as it steps; a pointer
 * resting on *arm64* fetches arm64's alone, a press of *x86-64* fetches x86-64's, and neither is fetched again by
 * choosing it, opening the panel or switching between them (machine code panel design §1 G3, §8). `mc-fetch.test.ts`'s
 * doc has why a fetching case is a file alone; these cases run in order on one page.
 */

const clif = () => host('clif-0') as HTMLElement
const stepOf = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''
const forward = () => clif().querySelector<HTMLButtonElement>('.controls button[aria-label="one step forward"]')

beforeAll(async () => {
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    sourceAndClif({ panels: { 'clif-0': { code: false } }, clifDisplay: { 'clif-0': { layout: 'compact' } } }),
  )
  await commands.watchRequests('start', MC_MATCH)
  await mountAt(1280, 896)
}, 30_000)

it('fetches nothing at start for a stored clif view whose panel is closed, nor as it steps', async () => {
  expect(mounted(), 'precondition: the stored workspace').toEqual(['source', 'clif-0'])
  await until(() => clif().querySelector('.clif-row.is-next') !== null, 'the clif view at its step 0')
  expect(codePanelOf(clif()).dataset.open, 'precondition: the panel closed').toBe('false')
  for (let step = 1; step <= 3; step += 1) {
    await userEvent.click(forward() as HTMLButtonElement)
    await until(() => stepOf(clif()).startsWith(`step ${step} of`), `the clif view to reach step ${step}`)
  }
  await sleep(1000)
  expect(await mcRequests()).toEqual({ 'x86-64': [], arm64: [] })
})

it('fetches arm64’s package alone once the pointer rests on its choice', async () => {
  await userEvent.hover(targetChoice(clif(), 'arm64'))
  await mcFetched('arm64')
  await sleep(400)
  expect((await mcRequests())['x86-64']).toEqual([])
})

it('fetches x86-64’s on a press of its choice, and neither again as they are chosen and shown', async () => {
  // A PRESS, AND AWAY, BY PLAYWRIGHT'S OWN MOUSE. **THE PRESS ALSO FOCUSES THE CHOICE**, a button, and the move to it
  // can begin a rest: each fetches the same package, so the case holds what any of them fetches, and
  // `clif-intent.test.ts` holds the press alone, on an element that takes no focus.
  const [on, away] = [
    pageCentreOf(targetChoice(clif(), 'x86-64')),
    pageCentreOf(clif().querySelector('.step') as Element),
  ]
  await commands.mouse('down', on.x, on.y)
  await commands.mouse('up', on.x, on.y)
  await commands.mouse('move', away.x, away.y)
  const first = await mcFetched('x86-64')
  await userEvent.click(targetChoice(clif(), 'arm64'))
  await userEvent.click(codePanelOf(clif()).querySelector('.panel-toggle') as HTMLElement)
  await until(() => codeRows(clif()).length > 0, 'the panel to show arm64’s rows')
  await userEvent.click(targetChoice(clif(), 'x86-64'))
  await until(() => targetChoice(clif(), 'x86-64').getAttribute('aria-checked') === 'true', 'x86-64 chosen')
  await until(() => codeRows(clif()).length > 0, 'the panel to show x86-64’s rows')
  await sleep(1000)
  const now = await mcRequests()
  expect(now, 'nothing asked for after both were in').toEqual(first)
  expect([...twice(now['x86-64']), ...twice(now.arm64)], 'a request made twice').toEqual([])
})
