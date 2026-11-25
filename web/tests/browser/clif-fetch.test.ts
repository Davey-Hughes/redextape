import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { INTENT_MS } from '../../src/clif-intent'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { CLIF_MATCH, clifRequests, hearSessionWorkers, requestsOf, sleep } from './clif-fixture'
import { mountAt, pageCentreOf, resetToFirstLoad, stateIdle, toggle, until } from './harness'

/**
 * **NOTHING OF `pkg-clif` IS FETCHED WITHOUT INTENT** (CLIF view design §8, *No fetch without intent*), heard as
 * Playwright hears the page's and its workers' requests (`vite.config.ts`'s `watchRequests`), from before `main()`
 * makes the session worker.
 *
 * **THE CASES THAT FETCH HAVE FILES OF THEIR OWN** (`clif-fetch-rest`, `clif-fetch-focus`, `clif-fetch-stored`):
 * `main()` runs once a page, and a package the worker holds is not asked for again, so a fetch in this file would leave
 * a later case nothing to hear. These two fetch nothing, so their order cannot matter.
 */

let ear: ReturnType<typeof hearSessionWorkers>

beforeAll(async () => {
  // THE DEFAULT WORKSPACE AT START, AND NOT `setup.ts`'s FOUR VIEWS: the claim is about the page a first visit opens.
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
  ear = hearSessionWorkers()
  await commands.watchRequests('start', CLIF_MATCH)
  await mountAt(1280, 896)
}, 30_000)

afterAll(() => ear.restore())

describe('the CLIF package', () => {
  it('fetches nothing for the default workspace', async () => {
    await resetToFirstLoad()
    await until(stateIdle, 'the first compile')
    await sleep(1000)
    // **A LOAD THE PAGE ASKED FOR IS AN INTENT IT HEARD**, which this case makes none of: it is the case's
    // precondition, not its claim, so an intent from outside the case fails here by that name, and not as a fetch
    // without intent.
    expect(requestsOf(ear.heard, 'clif-load'), 'precondition: the page asked for no clif load').toEqual([])
    expect(await clifRequests()).toEqual([])
  })

  /**
   * **TWO MOVES OF PLAYWRIGHT'S OWN MOUSE, NOT TWO `userEvent.hover`s**: a hover waits for its element to be stable
   * first, and two of them took longer than `INTENT_MS`, so the pointer would have rested rather than passed.
   */
  it('fetches nothing for a pointer passing over it', async () => {
    expect(await clifRequests(), 'precondition: nothing fetched before the pointer came').toEqual([])
    const [over, past] = [pageCentreOf(toggle('clif')), pageCentreOf(toggle('lambda'))]
    let entered = false
    toggle('clif').addEventListener('pointerenter', () => {
      entered = true
    })
    const started = performance.now()
    await commands.mouse('move', over.x, over.y)
    await commands.mouse('move', past.x, past.y)
    const passed = performance.now() - started
    expect(entered, 'precondition: the pointer entered the CLIF toggle').toBe(true)
    expect(passed, 'precondition: the pointer left the CLIF toggle inside INTENT_MS').toBeLessThan(INTENT_MS)
    await sleep(400)
    expect(await clifRequests()).toEqual([])
  })
})
