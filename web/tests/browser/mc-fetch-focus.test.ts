import { beforeAll, expect, it } from 'vitest'
import { commands, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { sleep } from './clif-fixture'
import { host, mountAt, until } from './harness'
import { codePanelOf, MC_MATCH, mcFetched, mcRequests, sourceAndClif, targetChoice } from './mc-fixture'

/**
 * The *x86-64* choice taking the focus fetches x86-64's package alone (machine code panel design §8): `mc-fetch.test.ts`'s
 * doc has why this is a file alone. **THE TABS GO BACK FROM THE VALUES PANEL'S TOGGLE**, which follows the machine code
 * panel's header, so that the focus reaches the choice as a keyboard user's does without passing the panel's own toggle,
 * which is intent of its own.
 */

/** The most presses of Shift+Tab the walk back may take. */
const MOST_TABS = 8

const clif = () => host('clif-0') as HTMLElement

beforeAll(async () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, sourceAndClif())
  await commands.watchRequests('start', MC_MATCH)
  await mountAt(1280, 896)
}, 30_000)

it('fetches x86-64’s package alone when its choice takes the focus', async () => {
  await until(() => clif().querySelector('.clif-row.is-next') !== null, 'the clif view at its step 0')
  expect(await mcRequests(), 'precondition: nothing fetched before the focus came').toEqual({ 'x86-64': [], arm64: [] })
  const toggle = codePanelOf(clif()).querySelector('.panel-toggle') as HTMLElement
  const passed: Element[] = []
  const hear = (e: FocusEvent) => {
    if (e.target instanceof Element) passed.push(e.target)
  }
  document.addEventListener('focusin', hear)
  ;(clif().querySelector('[data-panel="values"] .panel-toggle') as HTMLElement).focus()
  for (let tabs = 0; tabs < MOST_TABS && document.activeElement !== targetChoice(clif(), 'x86-64'); tabs += 1)
    await userEvent.tab({ shift: true })
  document.removeEventListener('focusin', hear)
  expect(document.activeElement, 'precondition: Shift+Tab reached the x86-64 choice').toBe(
    targetChoice(clif(), 'x86-64'),
  )
  expect(passed.includes(toggle), 'precondition: the focus never on the panel’s toggle').toBe(false)
  await mcFetched('x86-64')
  await sleep(400)
  expect((await mcRequests()).arm64).toEqual([])
})
