import type { EditorView } from '@codemirror/view'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { fieldWidths } from '../../../pkg/redextape_wasm.js'
import { CLIF_ABSENT, type Listing } from '../../src/protocol'
import { decodeLink } from '../../src/share-link'
import { clifChunks, clifStopped, hearSessionWorkers, repliesOf, requestsOf } from './clif-fixture'
import {
  frames,
  host,
  PREFIX,
  picker,
  resultsText,
  SHELL,
  shareButton,
  shareLinkField,
  shareMenu,
  stateIdle,
  stepTextOf,
  until,
} from './harness'

/**
 * **NOTHING ACTS ON THE RECORDING A LISTING CHOSEN IS REPLACING** while the CLIF view still shows it (`ClifHold`):
 * from the press until the chosen listing's first frames, `▶` at the end of the history and `keep recording` ask the
 * worker for nothing, `↺` asks for no rewind, and a link made carries no CLIF step. Each gesture is made with the
 * worker's replies kept from the page from just before the press (`hearSessionWorkers`' `hold`), so it lands inside
 * the hold however long it takes, and the replies are handed on after it: the chosen listing then lands as it would.
 */

/** `measure::CORPUS`'s `loop1000000`, whose CLIF leg records until its history is full, and can be recorded on. */
const LOOP = 'let mut i = 0; let mut acc = 0; while i < 1000000 { acc = acc + i; i = i + 1; } acc'

let ear: ReturnType<typeof hearSessionWorkers>
let view: EditorView

beforeAll(async () => {
  ear = hearSessionWorkers()
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: LOOP } })
  await until(() => !stateIdle(), 'the compile to start')
  await until(stateIdle, 'the compile to finish')
  const shown = ear.heard.length
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a CLIF view')
  await until(() => requestsOf(ear.heard.slice(shown), 'clif').length > 0, 'the clif request the view posts')
  await settled(shown)
}, 30_000)

afterAll(() => ear.restore())
/** A case that fails while it keeps the worker's replies would leave the next one waiting on them. */
afterEach(() => ear.release())

const clif = () => host('clif-0') as HTMLElement
const choice = (listing: Listing) =>
  clif().querySelector<HTMLButtonElement>(`.view-actions [role="radiogroup"] button[data-value="${listing}"]`)
const button = (name: string) =>
  clif().querySelector<HTMLButtonElement>(`.controls button[aria-label="${name}"]`) as HTMLButtonElement
const keepRecording = () => clif().querySelector<HTMLButtonElement>('.controls button.extend') as HTMLButtonElement

/** Wait until the CLIF recording the first `clif` request heard since `mark` asked for has stopped and is drawn. */
async function settled(mark: number): Promise<void> {
  const epoch = requestsOf(ear.heard.slice(mark), 'clif')[0]?.epoch ?? -1
  await until(() => clifStopped(ear.heard.slice(mark), epoch), 'the CLIF recording')
  await until(() => !stepTextOf('clif-0').includes('…'), 'the CLIF view to draw where it stopped')
}

/**
 * Keep the worker's replies from the page and choose `to`: the CLIF leg is held from here until `release`. Gives
 * where in `heard` the press began.
 */
async function chooseHeld(to: Listing): Promise<number> {
  ear.hold()
  const pressed = ear.heard.length
  await userEvent.click(choice(to) as HTMLButtonElement)
  await until(() => requestsOf(ear.heard.slice(pressed), 'clif').length > 0, 'the clif request the press posts')
  expect(requestsOf(ear.heard.slice(pressed), 'clif')[0]?.listing, 'precondition: the other listing').toBe(to)
  return pressed
}

/** Hand the kept replies on, and wait until the chosen listing is drawn at its step 0 where its recording stopped. */
async function release(to: Listing, pressed: number): Promise<void> {
  await ear.release()
  await settled(pressed)
  expect(choice(to)?.getAttribute('aria-checked'), 'the listing chosen').toBe('true')
  expect(stepTextOf('clif-0'), 'the listing chosen, at its step 0, where its recording stopped').toMatch(/^step 0 of /)
}

/** Open the share menu and read the link it makes, once it is other than `previous`. */
async function shared(previous: string): Promise<{ readonly value: string; readonly clif: number | undefined }> {
  await userEvent.click(shareButton())
  await until(() => shareLinkField().value !== '' && shareLinkField().value !== previous, 'the link')
  const value = shareLinkField().value
  const opened = await decodeLink(
    value.slice(value.indexOf('#')),
    [...picker().options].map((o) => o.value),
    fieldWidths() as number[],
  )
  shareMenu().hidePopover()
  if (opened.kind !== 'whole') throw new Error(`the share made a ${opened.kind} link`)
  return { value, clif: opened.positions.clif }
}

describe('a gesture while a listing chosen is held', () => {
  it('▶ at the end of the history and keep recording ask for nothing', async () => {
    expect(keepRecording().textContent, 'precondition: the history is full, and can be recorded on').toBe(
      'keep recording',
    )
    await userEvent.click(button('to the newest recorded step'), { force: true })
    expect(stepTextOf('clif-0'), 'precondition: the view is at the end of its history').toMatch(
      /^step ([\d,]+) of \1\b/,
    )
    const pressed = await chooseHeld('optimised')
    await userEvent.click(button('one step forward'), { force: true })
    expect(requestsOf(ear.heard.slice(pressed), 'extend'), '▶ at the end asks for no recording').toEqual([])
    await userEvent.click(keepRecording(), { force: true })
    expect(requestsOf(ear.heard.slice(pressed), 'extend'), 'keep recording asks for none').toEqual([])
    await release('optimised', pressed)
  }, 30_000)

  it('↺ on a history that dropped its start asks for no rewind', async () => {
    const mark = ear.heard.length
    await userEvent.click(keepRecording(), { force: true })
    await until(() => requestsOf(ear.heard.slice(mark), 'extend').length > 0, 'the extend keep recording posts')
    const epoch = requestsOf(ear.heard.slice(mark), 'extend')[0]?.epoch ?? -1
    await until(
      () => clifChunks(ear.heard.slice(mark), epoch).some((c) => c.done !== null),
      'the recording kept on to stop',
    )
    await until(() => stepTextOf('clif-0').includes('oldest kept'), 'the step line saying the start was dropped')
    const pressed = await chooseHeld('as-built')
    await userEvent.click(button('back to step 0'), { force: true })
    expect(requestsOf(ear.heard.slice(pressed), 'rewind'), '↺ asks for no rewind').toEqual([])
    await release('as-built', pressed)
  }, 30_000)

  /**
   * **A RESULT WITH NO CLIF PART** is what the worker sends for another request once it has dropped the stepper the
   * choice replaces and before the new one's first frames: made here from the last result the page heard, since no
   * gesture can time that window. The readout keeps its CLIF rows, and so every view stays where it stands.
   */
  it("a result of another request keeps the readout's CLIF rows", async () => {
    await until(() => resultsText().includes('clif'), "the readout's CLIF rows")
    const last = repliesOf(ear.heard, 'result').at(-1)
    if (last === undefined) throw new Error('precondition: no result was heard')
    const readout = resultsText()
    const top = () => Math.round(clif().getBoundingClientRect().top)
    const at = top()
    const pressed = await chooseHeld('optimised')
    ear.inject({ ...last, legs: { ...last.legs, clif: CLIF_ABSENT } })
    await frames()
    expect(resultsText(), 'the readout as it was').toBe(readout)
    expect(top(), 'the CLIF view where it stood').toBe(at)
    await release('optimised', pressed)
  }, 30_000)

  it('a link made carries no CLIF step', async () => {
    await userEvent.click(button('to the newest recorded step'), { force: true })
    const at = Number(/^step ([\d,]+)/.exec(stepTextOf('clif-0'))?.[1]?.replaceAll(',', '') ?? Number.NaN)
    expect(at, 'precondition: the view is past step 0').toBeGreaterThan(0)
    const first = await shared('')
    expect(first.clif, 'precondition: a link made before the press carries the CLIF step').toBe(at)
    const pressed = await chooseHeld('as-built')
    const held = await shared(first.value)
    expect(held.clif, 'a link made while the listing chosen is held').toBeUndefined()
    await release('as-built', pressed)
  }, 30_000)
})
