import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * **THE READOUT SAYS WHEN THE TM LEG'S HISTORY FILLED, AT THE STEP IT FILLED AT** — the strip in Explorer, the
 * inspector in Debugger. Both used to read only the compile's result, which counts the WHOLE run (`TM 9 · 91,785
 * transitions`), so a recording that stopped on its history budget was said by the TM view's step line and by nothing
 * the readout showed. The step it names is the step line's `of N`, the newest step the recording holds.
 *
 * **`map and fold`, PICKED FROM `examples ▾` WITH THE POINTER**: its TM history fills before the machine halts (its
 * menu line says so), and one *keep recording* then carries the recording to the halt, which is where the fact has to
 * go away again. `fact(12)` fills too, but its machine runs 481,964 transitions and takes several presses to end.
 *
 * ONE MOUNT FOR THE FILE, for the reason every sibling gives; the cases run in order, each from where the last left the
 * page, and each asserts the state it starts from before it measures anything.
 *
 * **EVERY LONG WAIT IS IN A HOOK, SPLIT.** Each hook has Vitest's 30 s to itself. At `CPUQuota=25%` the TM history
 * filled about 7 s after its recording started. During *keep recording* the wait for the recording to be half way to
 * the halt took 10,792 and 12,903 ms in two instrumented runs, polled once, at the halt, and passed only because
 * `until` reads its predicate before its deadline after every sleep (`until`'s doc; `harness.test.ts` holds the
 * order): `History` moved every frame it kept at each eviction, and the page ran no timer. Since it stopped, three
 * runs of an instrumented copy at 25 %, interleaved with three on `53ecbfa`, took 991 to 1,296 ms against 5,109 to
 * 7,988, polled at most 396 ms apart.
 */

const results = () => document.querySelector<HTMLElement>('#results') as HTMLElement
const idle = () => results().dataset.state === 'idle'
const tmStep = () => document.querySelector('[data-leaf="tm-0"] .step')?.textContent ?? ''
/** The TM segment of the strip — the third, in `LEGS`' order — or `undefined` while the readout is not the strip. */
const tmSegment = () => results().querySelectorAll<HTMLElement>('.segment')[2]
/** What the inspector's row labelled `label` says, or `undefined` for no such row. */
const row = (label: string) =>
  [...results().querySelectorAll('.row')]
    .find((r) => r.querySelector('.row-label')?.textContent === label)
    ?.querySelector('.row-value')?.textContent ?? undefined
/** The newest step a step line names — its `of N` — as the line prints it: `69,008` from `step 69,008 of 69,008 — …`. */
const newest = (line: string) => /of ([\d,]+)/.exec(line)?.[1] ?? ''
const count = (printed: string) => Number(printed.replaceAll(',', ''))
const extend = () => document.querySelector<HTMLButtonElement>('[data-leaf="tm-0"] .controls .extend')
/** What the strip's TM segment reads with no full history in it: the value, the run's count and the width. */
const PLAIN = /^TM 9 · [\d,]+ transitions · width \d+$/

async function workspace(selector: string): Promise<void> {
  await userEvent.click(document.querySelector<HTMLButtonElement>('#workspace') as HTMLButtonElement)
  await userEvent.click(document.querySelector<HTMLElement>(`#workspace-menu ${selector}`) as HTMLElement)
  if (document.querySelector('#workspace-menu')?.matches(':popover-open')) await userEvent.keyboard('{Escape}')
}

/** Where the TM recording stopped when its history filled, read off its step line by the first case. */
let full = ''

/**
 * THE MOUNT AND THE PICK ARE TWO HOOKS, each with Vitest's bound to itself: as one, at `CPUQuota=25%` on a machine
 * busy with other suites, it took 24.9 s of the 30 s.
 */
beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  await until(() => idle() && view.state.doc.length > 0 && tmSegment() !== undefined, 'the first compile')
})

describe('the readout, when the TM history fills', () => {
  beforeAll(async () => {
    await userEvent.click(document.querySelector<HTMLButtonElement>('#examples') as HTMLButtonElement)
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('#examples-menu [data-example="map-fold"]') as HTMLElement,
    )
    // λ AND ASM RECORD FIRST, SO THE TM LEG STARTS LAST; its history then fills at 69,008 on `047b0dd`, and the two
    // middle waits stop at a third and two thirds of that way, or at the fill if it comes first.
    // A STATE THE LINE CANNOT SKIP: no poll may land while the TM records, and the line then goes straight to full.
    await until(
      () => tmStep().includes('…') || tmStep().includes('history is full'),
      'the TM recording of map and fold to start',
    )
    await until(
      () => count(newest(tmStep())) >= 23_000 || tmStep().includes('history is full'),
      'the TM recording of map and fold to be under way',
    )
    await until(
      () => count(newest(tmStep())) >= 46_000 || tmStep().includes('history is full'),
      'the TM recording of map and fold to be two thirds of the way',
    )
    await until(() => tmStep().includes('history is full'), 'the TM history of map and fold to fill')
    await until(() => idle() && tmSegment()?.title.startsWith('TM 9 · ') === true, 'map and fold’s result')
  })

  it('says in the strip that the TM history is full, at the step its step line stopped at', () => {
    // PRECONDITION: the TM view's step line says the recording filled, and the strip is reading the program.
    expect(tmStep(), 'precondition: the TM step line').toMatch(/^step [\d,]+ of [\d,]+ — history is full/)
    expect(results().dataset.describes, 'precondition: the strip reads the program').toBe('program')
    full = newest(tmStep())
    const segment = tmSegment() as HTMLElement
    // THE STEP LINE'S OWN NUMBER, not the run's count beside it; and AFTER THE COUNT AND BEFORE THE WIDTH.
    expect(segment.title).toContain(`history is full at ${full}`)
    expect(segment.title).toMatch(new RegExp(`^TM 9 · [\\d,]+ transitions · history is full at ${full} · width \\d+$`))
  })

  it('says the same in the inspector, under the Debugger preset', async () => {
    expect(full, 'precondition: the first case read the step').not.toBe('')
    await workspace('[data-preset="debugger"]')
    await until(() => results().querySelector('.row') !== null, 'the inspector’s rows')
    expect(document.querySelector<HTMLElement>('#inspector')?.contains(results()), 'precondition: the inspector').toBe(
      true,
    )
    expect(row('TM value'), 'precondition: the inspector reads map and fold').toBe('9')
    expect(row('TM recording')).toBe(`history is full at ${full}`)
  })
})

/**
 * **THE FACT FOLLOWS THE RECORDING, NOT THE COMPILE.** *keep recording* runs the TM leg on from where it stopped, and on
 * `map and fold` it reaches the machine's halt, where the recording ENDED: neither readout says the history filled.
 *
 * **THE RECORDING IS NOT CAUGHT HALF WAY BY POLLING, AND THAT IS NOT AN OVERSIGHT.** A case read the strip at the first
 * poll that saw the step move, and in one run in 24 that poll already saw the halt; at `CPUQuota=25%`, while `History`
 * moved every frame it kept at each eviction, the poll after one at 3,210 ms ran at 12,194 ms, at the halt. Whether a
 * poll lands half way is timing, so no case here asserts it.
 * `readout.test.ts` holds a recording still going, `done: null`, to no fact, and `readout-history-held.test.ts` places
 * a continue's window by holding its `result` back.
 */
describe('the readout, once keep recording carries the TM on', () => {
  beforeAll(async () => {
    await workspace('[data-preset="explorer"]')
    await until(() => tmSegment() !== undefined, 'the strip')
    // PRECONDITION: the recording is still stopped where it filled, and offers to go on.
    expect(tmStep(), 'precondition: still stopped where it filled').toContain(`of ${full} — history is full`)
    expect(extend()?.textContent, 'precondition: the TM view offers keep recording').toBe('keep recording')
    const total = count(/^TM 9 · ([\d,]+) transitions/.exec(tmSegment()?.title ?? '')?.[1] ?? '')
    await userEvent.click(extend() as HTMLButtonElement)
    await until(() => newest(tmStep()) !== full, 'the TM recording to move on')
    await until(
      () => count(newest(tmStep())) >= (count(full) + total) / 2 || !tmStep().includes('…'),
      'the TM recording to be half way to the halt',
    )
    await until(() => !tmStep().includes('…') && idle(), 'the TM recording to stop again')
  })

  it('says nothing of a full history once the recording ends at the halt', () => {
    // NO `…` AND NO STOP REASON: ended. The head is wherever the ring left it, not on the halt (`History`).
    expect(tmStep(), 'precondition: the recording ended').toMatch(
      /^step [\d,]+ of [\d,]+ \(oldest kept: step [\d,]+\)$/,
    )
    expect(tmSegment()?.title).toMatch(PLAIN)
  })

  it('and nor does the inspector', async () => {
    await workspace('[data-preset="debugger"]')
    await until(() => results().querySelector('.row') !== null, 'the inspector’s rows')
    expect(row('TM value'), 'precondition: the inspector reads map and fold').toBe('9')
    expect(row('TM recording')).toBeUndefined()
  })
})
