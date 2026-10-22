import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { encodeLink } from '../../src/share-link'
import { serializeWorkspace } from '../../src/workspace'
import { countOf, fourViewWorkspace, newest, noticeText, results, resultsIdle, SHELL, until } from './harness'

/**
 * **THE READOUT'S FULL HISTORY AT THE MOMENTS A POLL CANNOT PLACE, PLACED BY HOLDING A REPLY BACK.** The strip draws
 * a result beside the legs' live recording, and the two arrive apart: the worker posts `result` once every leg has
 * recorded, and again after a continue. Holding a `result` back from the app while the frames it would follow have
 * landed keeps the strip in exactly the window under test, for as long as a case needs, on any runner.
 *
 * **EVERY `result` THE APP TAKES IN IS COUNTED, AND ONE CAN BE HELD**, by wrapping `Worker`'s own `addEventListener`
 * before the app mounts, as `share-positions.test.ts` does: a held reply reaches the app's listener only when a case
 * lets it go, and a counted one has been handled by the time it is counted. **AN `extend` THE APP POSTS CAN BE HELD
 * TOO**, by wrapping `postMessage`: a link's continue then waits, with the leg stopped where its history filled.
 *
 * **`sum_to(10000)` UNDER `unary`**, the encoding `setup.ts` stores the page's program under: its asm history fills
 * at 36,921 of its 140,014 instructions and fills again on one *keep recording*, and `unary` declines its TM leg, so a
 * compile records only λ, which the depth guard stops at once, and asm. ONE MOUNT FOR THE FILE, for the reason
 * `app.test.ts` gives; the cases run in order, each from where the last left the page.
 */

/** Whether a `result` is held back from the app, and the replies held. */
let holdingResults = false
const heldResults: (() => void)[] = []
/** How many `result` replies the app has taken in. */
let resultsTaken = 0
const listen = Worker.prototype.addEventListener
Worker.prototype.addEventListener = function (
  this: Worker,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  const counted =
    type === 'message' && typeof listener === 'function'
      ? (e: Event) => {
          if ((e as MessageEvent).data?.kind !== 'result') return listener.call(this, e)
          const take = () => {
            listener.call(this, e)
            resultsTaken += 1
          }
          if (holdingResults) heldResults.push(take)
          else take()
        }
      : listener
  listen.call(this, type, counted, options)
}
/** Give the app each `result` held, and hold no more. */
const letResultsGo = (): void => {
  holdingResults = false
  for (const take of heldResults.splice(0)) take()
}
/** Whether an `extend` the app posts is held back from the worker, and the posts held. */
let holdingExtends = false
const heldExtends: (() => void)[] = []
const post = Worker.prototype.postMessage
Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]): void {
  const send = () => (post as (...args: unknown[]) => void).apply(this, [message, ...rest])
  if (holdingExtends && (message as { kind?: unknown } | null)?.kind === 'extend') heldExtends.push(send)
  else send()
}
/** Post each `extend` held, and hold no more. */
const letExtendsGo = (): void => {
  holdingExtends = false
  for (const send of heldExtends.splice(0)) send()
}
/**
 * Let everything held go, after each group: a group whose hook threw while holding would otherwise leave a reply held
 * for the next group's wait on `heldResults.length` to count as its own.
 */
const letAllGo = (): void => {
  letResultsGo()
  letExtendsGo()
}
/** Assert nothing is held from before, ahead of a group's own hold. */
const nothingHeld = (): void => {
  expect(heldResults, 'precondition: no result held from before').toHaveLength(0)
  expect(heldExtends, 'precondition: no extend held from before').toHaveLength(0)
}

const SUM_TO_10000 = (EXAMPLES.find((e) => e.id === 'sum-to')?.text ?? '').replace('sum_to(5)', 'sum_to(10000)')

const segments = () => [...results().querySelectorAll<HTMLElement>('.segment')].map((s) => s.title)
const asmStep = () => document.querySelector('[data-leaf="asm-0"] .step')?.textContent ?? ''
const extend = () => document.querySelector<HTMLButtonElement>('[data-leaf="asm-0"] .controls .extend')

let view: EditorView

beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => resultsIdle() && resultsTaken > 0 && segments().length === 3, 'the first compile')
})

afterAll(() => {
  letAllGo()
  Worker.prototype.addEventListener = listen
  Worker.prototype.postMessage = post
})

/**
 * **A FACT IS DRAWN ONLY BESIDE A RESULT OF THE COMPILE THE LEGS RECORD.** A recompile's `compiled` reply resets the
 * legs, and its `result` follows once they have recorded, so for that whole time the result drawn is the previous
 * program's. The new program's asm history fills while its `result` is held, and the strip must go on reading the old
 * result alone, dimmed for the compile in flight, until the new one lands with its own fact.
 */
describe('a recompile whose result is held while its recording fills', () => {
  afterAll(letAllGo)

  /** The strip before the edit: the previous program's result, with no full history in it. */
  let before: string[] = []
  let taken = 0

  beforeAll(async () => {
    before = segments()
    taken = resultsTaken
    expect(before.join(' '), 'precondition: the previous program fills nothing').not.toContain('history is full')
    nothingHeld()
    holdingResults = true
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SUM_TO_10000 } })
    await until(() => asmStep().includes('history is full'), 'the new program’s asm history to fill')
    await until(() => heldResults.length === 1, 'the new program’s result to be posted, and held')
  })

  it('draws the previous program’s result alone while the new recording has filled', () => {
    expect(resultsTaken, 'precondition: no result has reached the app since the edit').toBe(taken)
    expect(asmStep(), 'precondition: the new asm recording filled').toMatch(/^step [\d,]+ of [\d,]+ — history is full/)
    expect(results().dataset.state, 'precondition: the compile is in flight').toBe('running')
    expect(segments()).toEqual(before)
  })

  it('draws the new program’s own fact once its result lands', async () => {
    letResultsGo()
    await until(() => resultsIdle() && segments()[1]?.startsWith('asm 50005000 ') === true, 'the new program’s result')
    expect(segments()[1]).toMatch(
      new RegExp(`^asm 50005000 · [\\d,]+ instructions · history is full at ${newest(asmStep())}$`),
    )
  })
})

/**
 * **THE FACT FOLLOWS *KEEP RECORDING*, READ ON EVERY FRAME AND NOT TAKEN WITH THE RESULT.** A continue's `result` is
 * posted once its recording stops, so a readout that took the legs with each result would show where the history
 * filled the time before until then. Holding that `result` back, the strip must already name the step where the asm
 * history filled again, beside the result it drew before the continue.
 */
describe('keep recording on the asm leg, its result held', () => {
  afterAll(letAllGo)

  let first = ''
  let taken = 0

  beforeAll(async () => {
    expect(asmStep(), 'precondition: the asm history is full').toContain('— history is full')
    expect(extend()?.textContent, 'precondition: the asm view offers keep recording').toBe('keep recording')
    first = newest(asmStep())
    taken = resultsTaken
    nothingHeld()
    holdingResults = true
    await userEvent.click(extend() as HTMLButtonElement)
    // FOUR WAITS, three on the recording and one on the held result, each with `until`'s 10 s to itself
    // on a slow runner.
    await until(() => newest(asmStep()) !== first, 'the asm recording to move on')
    await until(
      () => countOf(newest(asmStep())) >= countOf(first) * 1.5 || asmStep().includes('— history is full'),
      'the asm recording to be half way to filling again',
    )
    await until(() => asmStep().includes('— history is full'), 'the asm history to fill again')
    await until(() => heldResults.length === 1, 'the continue’s result to be posted, and held')
  })

  it('names the step where the asm history filled again, beside the result drawn before the continue', () => {
    expect(resultsTaken, 'precondition: the continue’s result has not reached the app').toBe(taken)
    const again = newest(asmStep())
    expect(again, 'precondition: the history filled further on').not.toBe(first)
    expect(segments()[1]).toContain(`history is full at ${again}`)
    expect(segments()[1]).toMatch(new RegExp(`^asm 50005000 · [\\d,]+ instructions · history is full at ${again}$`))
  })

  it('still names it once that result lands', async () => {
    const again = newest(asmStep())
    letResultsGo()
    await until(() => resultsTaken === taken + 1, 'the continue’s result')
    expect(segments()[1]).toMatch(new RegExp(`^asm 50005000 · [\\d,]+ instructions · history is full at ${again}$`))
  })
})

/**
 * **NOT AT A STOP A LINK IS TAKING THE LEG PAST.** A link to `sum_to(10000)` with the asm leg at step 40,000: its history
 * fills at 36,921, the run's `result` lands, and the link asks for a continue, held here. The step line says where the
 * link is taking the leg in place of `— history is full`, and the strip must not say the history is full either.
 *
 * **THE CONTINUE IS NOT FOLLOWED TO THE NEXT FILL HERE**: `readout.test.ts` holds what the strip says of a leg
 * with no pending step, that its history is full.
 */
describe('a link taking the asm leg past where its history fills, its continue held', () => {
  afterAll(letAllGo)

  beforeAll(async () => {
    const taken = resultsTaken
    nothingHeld()
    holdingExtends = true
    location.hash = await encodeLink({
      program: SUM_TO_10000,
      encoding: 'unary',
      workspace: serializeWorkspace(fourViewWorkspace()),
      positions: { asm: 40_000 },
    })
    await until(() => location.hash === '' && noticeText() === 'opened a shared link', 'the open')
    await until(() => resultsTaken > taken, 'the link’s run')
    await until(() => heldExtends.length === 1, 'the link’s continue to be posted, and held')
  })

  it('says nothing of a full history at the stop the link goes on past', () => {
    expect(asmStep(), 'precondition: stopped where it filled, the link going further').toMatch(
      // NO `…` AFTER THE COUNT: stopped. The head waits where the run opened until the frames reach the link's step.
      /^step [\d,]+ of [\d,]+ — going to step 40,000 from the link/,
    )
    expect(resultsIdle(), 'precondition: the link’s run has its result').toBe(true)
    expect(segments()[1]).not.toContain('history is full')
    expect(segments()[1]).toMatch(/^asm 50005000 · [\d,]+ instructions$/)
  })
})
