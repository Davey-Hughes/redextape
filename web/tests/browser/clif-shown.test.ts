import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { bindingKey } from '../../src/view-header'
import { clifSteps, clifStopped, hearSessionWorkers, repliesOf, requestsOf } from './clif-fixture'
import { focusProgram, host, mountAt, PREFIX, resultsText, stateIdle, toggle, until } from './harness'

/**
 * **THE CLIF LEG RECORDS ONLY WHILE A CLIF VIEW IS SHOWN** (CLIF view design §6, *Recording while shown*), heard
 * between the page and its session worker: a view shown after the run asks for a record from step 0 under a raised
 * epoch, a hidden one is dropped under a higher one, and a view shown while a run is in flight waits for that run.
 */

let ear: ReturnType<typeof hearSessionWorkers>

beforeAll(async () => {
  ear = hearSessionWorkers()
  await mountAt(1280, 896)
}, 30_000)

afterAll(() => ear.restore())

/** The `clif` requests posted since `mark`, an index into what was heard. */
const clifAsked = (mark: number) => requestsOf(ear.heard.slice(mark), 'clif')

/** The view keys, then `5`. */
async function pressFive(): Promise<void> {
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
}

/** Whether a CLIF view is on the page. */
const clifShown = (): boolean => document.querySelector('#views [data-kind="clif"]') !== null

/** No CLIF view, the program's run settled: where each case starts. */
async function start(): Promise<void> {
  if (toggle('clif').getAttribute('aria-pressed') === 'true') await userEvent.click(toggle('clif'))
  await until(() => !clifShown() && stateIdle(), 'no CLIF view, and the run settled')
}

/** The next `clif` request posted since `mark`, once there is one. */
async function nextClif(mark: number, what: string) {
  await until(() => clifAsked(mark).length > 0, what)
  return clifAsked(mark)[0] as NonNullable<ReturnType<typeof clifAsked>[number]>
}

/** Every step from 0 to the last of `steps`, in order: a recording from step 0 with no gap. */
const fromZero = (steps: readonly number[]): number[] => Array.from({ length: steps.length }, (_, i) => i)

/**
 * That the CLIF frames recorded under `epoch` since `mark` start at step 0 and have no gap. **SINCE `mark`**: a later
 * run's epochs start from 0 again, so an earlier run's frames can carry the same epoch.
 */
function fromStepZero(epoch: number, mark: number): void {
  const steps = clifSteps(ear.heard.slice(mark), epoch)
  expect(steps[0], `the first CLIF frame of epoch ${epoch}`).toBe(0)
  expect(steps, `the CLIF frames of epoch ${epoch}`).toEqual(fromZero(steps))
}

/**
 * That the CLIF view's own step controls are live once its frames are in: its play button is enabled, and its step line
 * counts steps rather than giving the reason an unavailable leg has. **READ ONCE THE RECORDING HAS SAID IT STOPPED**:
 * the page's listener takes that chunk in the same dispatch as this file's, and a chunk that ends a recording draws at
 * once.
 */
function controlsLive(): void {
  const view = document.querySelector<HTMLElement>('#views [data-kind="clif"]')
  expect(view?.querySelector<HTMLButtonElement>('.controls button.play')?.disabled, "the CLIF view's play button").toBe(
    false,
  )
  expect(view?.querySelector('.step')?.textContent ?? '', "the CLIF view's step line").toMatch(/^step \d/)
}

describe('a CLIF view shown and hidden', () => {
  it('key 5 records the CLIF leg from step 0, and hiding it drops its history', async () => {
    await start()
    let mark = ear.heard.length
    await pressFive()
    expect(clifShown(), 'precondition: 5 showed a CLIF view').toBe(true)
    const shown = await nextClif(mark, 'the clif request 5 posts')
    expect(shown.listing).toBe('as-built')
    expect(shown.epoch, "its epoch, above the one the program's compile left").toBeGreaterThan(0)
    await until(() => clifStopped(ear.heard.slice(mark), shown.epoch), "the CLIF leg's recording under its epoch")
    fromStepZero(shown.epoch, mark)
    controlsLive()
    await until(() => resultsText().includes('CLIF'), "the CLIF pass's result in the readout")

    mark = ear.heard.length
    await userEvent.click(host('clif-0')?.querySelector('.view-close') as HTMLElement)
    expect(clifShown(), 'precondition: ✕ hid the CLIF view').toBe(false)
    expect(resultsText(), 'the readout once the CLIF view is hidden').not.toContain('CLIF')
    const hidden = await nextClif(mark, 'the clif request ✕ posts')
    expect(hidden.listing).toBeNull()
    expect(hidden.epoch, 'its epoch, above the shown one').toBeGreaterThan(shown.epoch)

    mark = ear.heard.length
    await pressFive()
    const again = await nextClif(mark, 'the clif request 5 posts again')
    expect(again.listing).toBe('as-built')
    expect(again.epoch, 'its epoch, above the hidden one').toBeGreaterThan(hidden.epoch)
    await until(() => clifStopped(ear.heard.slice(mark), again.epoch), "the CLIF leg's recording under the third epoch")
    fromStepZero(again.epoch, mark)
    controlsLive()
  })

  it('a CLIF view shown while a run is in flight records for that run', async () => {
    await start()
    focusProgram()
    const mark = ear.heard.length
    await userEvent.keyboard(' ')
    await pressFive()
    const pressed = ear.heard.length
    await until(() => repliesOf(ear.heard.slice(mark), 'compiled').length > 0, "the keystroke's compiled")
    const at = ear.heard.findIndex((h, i) => i >= mark && 'reply' in h && h.reply.kind === 'compiled')
    expect(at, "precondition: the CLIF view was shown before the run's compiled").toBeGreaterThanOrEqual(pressed)
    expect(requestsOf(ear.heard.slice(mark, at), 'clif'), 'the clif requests before the compiled').toEqual([])
    const { gen } = repliesOf(ear.heard.slice(at), 'compiled')[0] as { gen: number }
    await until(
      () => repliesOf(ear.heard.slice(at), 'frames').some((c) => c.leg === 'clif' && c.gen === gen),
      "the CLIF leg's frames for the run",
    )
  })

  it("+ view's CLIF item shows and records it", async () => {
    await start()
    // A RUN WITH NO CLIF VIEW FIRST, so that the leg this view shows is the one such a run leaves, and not one an
    // earlier case's run left available.
    focusProgram()
    const typed = ear.heard.length
    await userEvent.keyboard(' ')
    await until(() => repliesOf(ear.heard.slice(typed), 'compiled').length > 0 && stateIdle(), "the keystroke's run")
    expect(requestsOf(ear.heard.slice(typed), 'run')[0]?.clif, 'precondition: the run carried no listing').toBeNull()
    const mark = ear.heard.length
    await userEvent.click(document.querySelector('#new-view') as HTMLElement)
    await userEvent.click(
      document.querySelector(`#new-view-menu button[data-binding="${bindingKey('clif', 'source')}"]`) as HTMLElement,
    )
    expect(clifShown(), 'precondition: the item showed a CLIF view').toBe(true)
    const shown = await nextClif(mark, 'the clif request the item posts')
    expect(shown.listing).toBe('as-built')
    await until(() => clifStopped(ear.heard.slice(mark), shown.epoch), "the CLIF leg's recording under its epoch")
    fromStepZero(shown.epoch, mark)
    controlsLive()
  })
})
