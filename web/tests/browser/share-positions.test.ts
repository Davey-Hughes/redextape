import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { encodeLink, type Positions } from '../../src/share-link'
import { MAX_LINK_CONTINUES } from '../../src/share-positions'
import { bindingKey } from '../../src/view-header'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A LINK'S POSITIONS, IN THE APP** — Plan 7 part 6a spec §5.4 and §8's positions row, on the real session worker:
 * `fact(4)`'s λ at 3,000 reached after two continues; at 1,387, which its continue's ring drops, landing on 1,388;
 * `sum_to(5)`'s λ at 5,000 clamped to 951; a step gesture taking a leg from its link before its first continue; and
 * `fact(12)`'s λ at 17,000 stopping at 15,695 after ten continues, with the open's `undo` on the notice that says so.
 * Each link is pasted into the open page, a `hashchange`, **UNDER `binary`, BUT `fact(12)`'s UNDER `unary`**: λ records
 * the same steps under both, a continue waits for the run's `result`, which comes after TM's recording, and `fact(4)`'s
 * TM records fewer steps under `binary` (spec §2.7). `fact(12)`'s case is about the TM leg `unary` declines.
 *
 * **EVERY REQUEST AND EVERY REPLY IS COUNTED**, by wrapping `Worker`'s own `postMessage` and `addEventListener` before
 * the app mounts: a continue is an `extend` posted, and a reply is counted after the app's listener has taken it in,
 * so once a `result` is counted, whatever continue it asked for has been posted; and a case can hold a `result` back
 * from the app until it lets it go. **ONE CONTINUE TO A CASE** for `fact(12)`: each takes most of a second here, and
 * a runner six times slower would put ten in one case past vitest's own bound. ONE MOUNT FOR THE FILE, for the reason
 * every sibling gives.
 */

const posted: { readonly kind?: unknown; readonly leg?: unknown }[] = []
const heard: { readonly kind?: unknown }[] = []
const post = Worker.prototype.postMessage
Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]): void {
  posted.push(message as (typeof posted)[number])
  ;(post as (...args: unknown[]) => void).apply(this, [message, ...rest])
}
/** Whether a `result` is held back from the app, and the replies held. */
let holdingResults = false
const heldResults: (() => void)[] = []
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
          const take = () => {
            listener.call(this, e)
            heard.push((e as MessageEvent).data)
          }
          if (holdingResults && (e as MessageEvent).data?.kind === 'result') heldResults.push(take)
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

const text = (id: string) => EXAMPLES.find((e) => e.id === id)?.text ?? ''
const FACT = text('fact')
const FACT_12 = text('fact-12')
const SUM_TO = text('sum-to')

const lambdaExtends = () => posted.filter((m) => m.kind === 'extend' && m.leg === 'lambda').length
const results = () => heard.filter((m) => m.kind === 'result').length
/**
 * **WAIT FOR `>=`, THEN ASSERT `===`**: the count advances by itself, as each continue's `result` posts the next, so a
 * wait for its exact value would, past an overshoot, time out saying the run never came. Here an overshoot fails on its
 * own assertion, naming the count.
 */
async function resultsReach(n: number, what: string): Promise<void> {
  await until(() => results() >= n, what)
  expect(results(), what).toBe(n)
}
const stepOf = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .step`)?.textContent ?? ''
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

let view: EditorView

/**
 * Paste a link to `program` under `encoding` in Explorer, with `positions`, and wait until the open is said. Answers the
 * `result`s and λ continues counted before it, so a case counts its own.
 */
async function open(
  program: string,
  positions: Positions,
  encoding = 'binary',
): Promise<{ results: number; extends: number }> {
  const before = { results: results(), extends: lambdaExtends() }
  const fragment = await encodeLink({
    program,
    encoding,
    workspace: serializeWorkspace(defaultWorkspace()),
    positions,
  })
  location.hash = fragment
  await until(() => location.hash === '' && noticeText() === 'opened a shared link', 'the open')
  return before
}

beforeAll(async () => {
  // WIDE ENOUGH FOR ITS ADDS: at the runner's default 414 px a view is 201 px wide, and the app refuses a split or a
  // `+ view` that leaves a view under `MIN_VIEW_PX` (`layout.ts`). The default's 896 px height is kept.
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && results() > 0, 'the first compile')
})

describe("a link's positions", () => {
  it("reaches fact(4)'s λ step 3,000 after two continues, saying where it is going meanwhile", async () => {
    const before = await open(FACT, { lambda: 3000 })
    await until(() => stepOf('lambda-0').includes('— going to step 3,000 from the link'), 'the pending position')
    // ONE WAIT A RESULT, so no one wait holds three recordings on a slow runner.
    await resultsReach(before.results + 1, 'the run')
    await resultsReach(before.results + 2, 'the first continue')
    await resultsReach(before.results + 3, 'the second continue')
    expect(lambdaExtends() - before.extends).toBe(2)
    expect(stepOf('lambda-0')).toBe('step 3,000 of 4,144 — history is full (oldest kept: step 2,769)')
  })

  /**
   * **THE FIRST STEP PAST THE RUN'S OWN RECORDING, WHICH IS THE OLDEST ITS CONTINUE'S RING KEEPS.** This case was
   * `1,387 … on 1,388`, a position the continue's ring had dropped, while a ring dropped the first frames of the
   * recording that filled it. It keeps that recording whole now (`History`'s `#evict`), and 1,387 is kept;
   * `tests/node/share-positions.test.ts` holds a position a ring has dropped.
   */
  it("lands fact(4)'s λ step 1,387, the first its continue records, on the oldest step its ring keeps", async () => {
    const before = await open(FACT, { lambda: 1387 })
    await resultsReach(before.results + 1, 'the run')
    await resultsReach(before.results + 2, 'the continue')
    expect(lambdaExtends() - before.extends).toBe(1)
    expect(stepOf('lambda-0')).toBe('step 1,387 of 2,768 — history is full (oldest kept: step 1,387)')
  })

  it("clamps sum_to(5)'s λ step 5,000 to its last, 951, and says so with the open's undo", async () => {
    const before = await open(SUM_TO, { lambda: 5000 })
    await until(() => noticeText().startsWith("the link's λ step"), 'the clamp')
    expect(noticeText()).toBe("the link's λ step 5,000 is past the end of this run — showing step 951")
    expect(undoButton()?.textContent).toBe('undo')
    expect(stepOf('lambda-0')).toBe('step 951 of 951')
    await resultsReach(before.results + 1, 'the run')
    expect(lambdaExtends()).toBe(before.extends)
  })
})

const forwardButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-leaf="lambda-0"] button[aria-label="one step forward"]',
  ) as HTMLButtonElement

/**
 * **A STEP GESTURE TAKES A LEG FROM ITS LINK** (spec §5.4) before its first continue, which the run's `result` would
 * have posted. **THE `result` IS HELD BACK UNTIL THE GESTURE HAS LANDED**: at a quarter of a core the real click took
 * long enough for the run to answer first, and the continue was posted before the gesture took the leg. ONE WAIT A
 * RESULT: the run waits in a case of its own, since there a real click while the frames arrive and the rest of the
 * recording outlasted vitest's bound for one case.
 */
describe('a step gesture before the first continue', () => {
  let before: { results: number; extends: number }

  it('takes the leg from its link', async () => {
    holdingResults = true
    before = await open(FACT, { lambda: 3000 })
    // FORWARD: the head waits on step 0, where a run opens (`History`), until the frames reach the link's step.
    await until(
      () => stepOf('lambda-0').includes('— going to step 3,000 from the link') && !forwardButton().disabled,
      'the pending position, with a step to take',
    )
    await userEvent.click(forwardButton())
    expect(stepOf('lambda-0')).not.toContain('going to')
  })

  it('continues it no further once the run has recorded', async () => {
    letResultsGo()
    await resultsReach(before.results + 1, 'the run')
    expect(lambdaExtends()).toBe(before.extends)
  })
})

/**
 * **`fact(12)`'s λ AT 17,000: TEN CONTINUES, THEN IT STOPS AT 15,695** (spec §5.4, row 16, §A.2), one continue to a
 * case. Its TM leg is declined under `unary`; that a declined leg's position is dropped is held in
 * `tests/node/share-positions.test.ts`, since a declined leg's step line says nothing a browser case could read. Part-way, a
 * notice of another gesture takes the open's notice off the line; the tenth continue's notice offers the open's `undo`
 * all the same, since nothing has withdrawn it (§5.5).
 */
describe("fact(12)'s λ at 17,000", () => {
  let before: { results: number; extends: number }
  const continued = (n: number) => resultsReach(before.results + 1 + n, `continue ${n}`)

  it('opens with λ going to step 17,000 from the link', async () => {
    before = await open(FACT_12, { lambda: 17000 }, 'unary')
    await resultsReach(before.results + 1, 'the run')
    expect(lambdaExtends() - before.extends).toBe(1)
    expect(stepOf('lambda-0')).toContain('— going to step 17,000 from the link')
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('posts the next continue once continue %i has recorded', async (n) => {
    await continued(n)
    expect(lambdaExtends() - before.extends).toBe(n + 1)
    expect(stepOf('lambda-0')).toContain('— going to step 17,000 from the link')
    // ANOTHER GESTURE'S NOTICE TAKES THE OPEN'S OFF THE LINE, WITHDRAWING NOTHING.
    if (n === 3) {
      await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
      await userEvent.click(
        document.querySelector<HTMLButtonElement>(
          `#new-view-menu button[data-binding="${bindingKey('asm', 'source')}"]`,
        ) as HTMLButtonElement,
      )
      await until(() => noticeText().startsWith('view added'), 'the view')
      expect(undoButton()).toBeNull()
    }
  })

  it(`stops at 15,695 after the tenth, with no eleventh, and says so with the open's undo`, async () => {
    await continued(MAX_LINK_CONTINUES)
    expect(lambdaExtends() - before.extends).toBe(MAX_LINK_CONTINUES)
    expect(noticeText()).toBe("the link's λ step 17,000 is further on than 10 continues went — showing step 15,695")
    expect(stepOf('lambda-0')).toBe('step 15,695 of 15,695 — history is full (oldest kept: step 14,272)')
    expect(undoButton()?.textContent).toBe('undo')
  })

  it('puts back the program the link replaced, on that undo', async () => {
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe(FACT)
    expect(noticeText()).toBe('put back the program and the workspace')
  })
})
