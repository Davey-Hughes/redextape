import { beforeAll, describe, expect, it, vi } from 'vitest'
import { commands, userEvent } from 'vitest/browser'
import { INTENT_MS } from '../../src/clif-intent'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { sleep } from './clif-fixture'
import { mountAt, pageCentreOf, resetToFirstLoad, stateIdle, toggle, until } from './harness'
import { codePanelOf, MC_MATCH, mcRequests, targetChoice } from './mc-fixture'

/**
 * **NOTHING OF EITHER MACHINE CODE PACKAGE IS FETCHED WITHOUT INTENT** (machine code panel design §1 G3, §8 *No fetch
 * without intent*): not by the default workspace, nor by a clif view opened and stepped, nor by a pointer passing over
 * a target choice, nor by a clif view drawn under a pointer that has not moved. Heard as Playwright hears the page's
 * and its workers' requests, from before `main()` makes the session worker.
 *
 * **THE CASES THAT FETCH HAVE FILES OF THEIR OWN** (`mc-fetch-rest`, `-focus`, `-toggle`, `-stored`): a package the
 * worker holds is not asked for again, so a fetch in this file would leave a later case nothing to hear. These fetch
 * nothing, so their order cannot matter.
 */

const clif = () => document.querySelector<HTMLElement>('#views [data-kind="clif"]')
const stepOf = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''
const control = (pane: HTMLElement, name: string) =>
  pane.querySelector<HTMLButtonElement>(`.controls button[aria-label="${name}"]`) as HTMLButtonElement
const NOTHING = { 'x86-64': [], arm64: [] }
/** Each long case's own bound, past every wait in it. */
const CASE_MS = 60_000

beforeAll(async () => {
  // THE DEFAULT WORKSPACE AT START, AND NOT `setup.ts`'s FOUR VIEWS: the claim is about the page a first visit opens.
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
  await commands.watchRequests('start', MC_MATCH)
  await mountAt(1280, 896)
}, 30_000)

describe('the machine code packages', () => {
  it(
    'fetches nothing for the default workspace, nor for a clif view opened, stepped and switched',
    async () => {
      await resetToFirstLoad()
      await until(stateIdle, 'the first compile')
      await sleep(1000)
      expect(await mcRequests(), 'the default workspace').toEqual(NOTHING)

      await userEvent.click(toggle('clif'))
      await until(() => clif()?.querySelector('.clif-row.is-next') !== null, 'a clif view at its step 0')
      const pane = clif() as HTMLElement
      expect(
        targetChoice(pane, 'arm64').getBoundingClientRect().width,
        'precondition: the target choice drawn',
      ).toBeGreaterThan(0)
      expect(codePanelOf(pane).dataset.open, 'precondition: the panel closed').toBe('false')
      for (let step = 1; step <= 3; step += 1) {
        await userEvent.click(control(pane, 'one step forward'))
        await until(() => stepOf(pane).startsWith(`step ${step} of`), `the clif view to reach step ${step}`)
      }
      await userEvent.click(control(pane, 'back to step 0'))
      await until(() => stepOf(pane).startsWith('step 0 of'), 'the clif view back at step 0')
      await sleep(1000)
      expect(await mcRequests(), 'a clif view opened and stepped').toEqual(NOTHING)

      const optimised = () =>
        (clif() as HTMLElement).querySelector<HTMLElement>('.view-actions [role="radiogroup"] [data-value="optimised"]')
      await userEvent.click(optimised() as HTMLElement)
      await until(() => optimised()?.getAttribute('aria-checked') === 'true', 'the optimised listing chosen')
      await until(() => clif()?.querySelector('.clif-row.is-next') !== null, 'the optimised listing at its step 0')
      await sleep(1000)
      expect(await mcRequests(), 'a listing switched with the panel closed').toEqual(NOTHING)
    },
    CASE_MS,
  )

  /**
   * **TWO MOVES OF PLAYWRIGHT'S OWN MOUSE, THE REST'S TIMER FAKED BETWEEN THEM**: two real moves are two round trips,
   * which a loaded machine can stretch past `INTENT_MS`, and the pass would then be a rest. Faked, the rest's time
   * passes only when the case says, after the pointer has left.
   */
  it('fetches nothing for a pointer passing over a target choice', async () => {
    const pane = clif() as HTMLElement
    const [over, past] = [pageCentreOf(targetChoice(pane, 'arm64')), pageCentreOf(toggle('lambda'))]
    const heard: string[] = []
    for (const type of ['pointermove', 'pointerleave'])
      targetChoice(pane, 'arm64').addEventListener(type, () => heard.push(type))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await commands.mouse('move', over.x, over.y)
      await commands.mouse('move', past.x, past.y)
      vi.advanceTimersByTime(2 * INTENT_MS)
    } finally {
      vi.useRealTimers()
    }
    expect(heard.slice(0, 1), 'precondition: the pointer moved on the arm64 choice').toEqual(['pointermove'])
    expect(heard.at(-1), 'precondition: and left it').toBe('pointerleave')
    await sleep(400)
    expect(await mcRequests()).toEqual(NOTHING)
  })

  /**
   * **THE VIEW IS TAKEN AWAY AND BROUGHT BACK BY ITS TOGGLE'S `click()`, NOT A GESTURE**, so the pointer never moves
   * while the view is drawn under it: a browser then tells the new choice the pointer is over it (`pointerover`), and
   * sends no `pointermove`, which is what `watchIntent` takes for a pointer that came to it.
   */
  it('fetches nothing for a clif view drawn under a pointer that has not moved', async () => {
    const before = targetChoice(clif() as HTMLElement, 'arm64').getBoundingClientRect()
    const [x, y] = [before.left + before.width / 2, before.top + before.height / 2]
    const at = pageCentreOf(targetChoice(clif() as HTMLElement, 'arm64'))
    toggle('clif').click()
    await until(() => clif() === null, 'the clif view to go')
    await commands.mouse('move', at.x, at.y)
    await sleep(INTENT_MS + 100)
    const heard: string[] = []
    const hear = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('.mc-target [data-value="arm64"]') !== null)
        heard.push(e.type)
    }
    for (const type of ['pointerover', 'pointermove']) document.addEventListener(type, hear, true)
    try {
      toggle('clif').click()
      await until(() => clif()?.querySelector('.clif-row.is-next') !== null, 'the clif view back at its step')
      const choice = targetChoice(clif() as HTMLElement, 'arm64')
      const box = choice.getBoundingClientRect()
      expect(
        x >= box.left && x <= box.right && y >= box.top && y <= box.bottom,
        'precondition: the arm64 choice drawn under the pointer',
      ).toBe(true)
      await sleep(INTENT_MS + 250)
      expect(heard, 'precondition: the browser told the choice it is under the pointer').toContain('pointerover')
      expect(
        heard.filter((t) => t === 'pointermove'),
        'a pointermove on the choice',
      ).toEqual([])
      expect(await mcRequests()).toEqual(NOTHING)
    } finally {
      for (const type of ['pointerover', 'pointermove']) document.removeEventListener(type, hear, true)
    }
  })
})
