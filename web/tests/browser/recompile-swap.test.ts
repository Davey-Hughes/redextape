import type { EditorView } from '@codemirror/view'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { NOTICE_MS } from '../../src/notice'
import {
  frame,
  frames,
  paneByLeaf,
  panelOf,
  picker,
  SHELL,
  showWideDefault,
  stateIdle,
  stepTextOf,
  undoButton,
  until,
} from './harness'

/**
 * **A RECOMPILE SWAPS EVERY VIEW TO THE NEW PROGRAM'S STEP 0 IN ONE FRAME** (recompile-flash design): no frame shows an
 * emptied TM tape or rxm register panel, the λ term as flat text, `not run`, or the TM rules panel moved. Each case is
 * one way a recompile of the program starts, with the λ, rxm and TM views and their panels open.
 *
 * **THE WORKER'S REPLIES ARE HANDED OVER ONE A PAINTED FRAME APART**, so every state between two replies is painted and
 * sampled however close together they were posted.
 */

const SRC =
  'fn sum_to(n) {\n    let mut acc = 0;\n    while n > 0 {\n        acc = acc + n;\n        n = n - 1;\n    }\n    acc\n}\n\nsum_to(5)'

const LEAVES = ['lambda-0', 'rxm-0', 'tm-0'] as const
type Leaf = (typeof LEAVES)[number]
const FORWARD = 'one step forward'

let view: EditorView

/** A session worker's reply not yet handed to the page, with its kind. */
type Held = { readonly kind: string; readonly hand: () => void }

/** The replies the page has not been handed yet, or `null` while they reach it as they come. */
let held: Held[] | null = null
const handed = new WeakSet<Event>()

/** Holds a session worker's reply while `held` is a list: the worker's first listener, so it runs before the app's. */
const hold = (worker: Worker, e: MessageEvent): void => {
  if (held === null || handed.has(e)) return
  e.stopImmediatePropagation()
  held.push({
    kind: String(e.data?.kind),
    hand: () => {
      const copy = new MessageEvent('message', { data: e.data })
      handed.add(copy)
      worker.dispatchEvent(copy)
    },
  })
}

const PageWorker = globalThis.Worker

/** What a frame paints of the three views, as far as a recompile can empty or move it. */
type Sample = {
  readonly tapes: number
  readonly registers: number
  readonly layout: string
  readonly lines: readonly string[]
  readonly rulesTop: number
}

const read = (): Sample => {
  const tm = paneByLeaf('tm-0')
  return {
    tapes: tm.querySelector('.tapes')?.childElementCount ?? -1,
    registers: paneByLeaf('rxm-0').querySelector('.rxm-registers')?.childElementCount ?? -1,
    layout: paneByLeaf('lambda-0').querySelector<HTMLElement>('.term')?.dataset.layout ?? '',
    lines: LEAVES.map((leaf) => stepTextOf(leaf)),
    // FROM THE TM VIEW'S OWN TOP, so the notice line moving every view below it, which the undo's does, is not counted.
    rulesTop: Math.round(panelOf(tm, 'rules').getBoundingClientRect().top - tm.getBoundingClientRect().top),
  }
}

/**
 * Sample every frame until the returned function is called, which answers the samples. **IN A `ResizeObserver`
 * CALLBACK**, which runs after the frame's animation callbacks and layout and before its paint, so a sample is what
 * that frame paints, an app redraw scheduled on an animation frame included.
 */
const sampling = (): (() => Sample[]) => {
  const samples: Sample[] = []
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:-50px;top:0;height:1px;width:1px;pointer-events:none'
  document.body.append(probe)
  // A box resized every frame, so the observer reports in every frame.
  const observer = new ResizeObserver(() => samples.push(read()))
  observer.observe(probe)
  let on = true
  let width = 1
  const tick = () => {
    if (!on) return
    width = 3 - width
    probe.style.width = `${width}px`
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  return () => {
    on = false
    observer.disconnect()
    probe.remove()
    return samples
  }
}

/**
 * Run `act` with the notices it draws held, and answer how many it held. **HELD, NOT RACED**: a notice's action goes
 * with it `NOTICE_MS` after it is drawn, and a case that reaches the action only after a settle and its steps would
 * race that clock on a machine short of CPU. A held notice's timer is never set, so it lasts until another notice
 * replaces it, its action runs or a gesture withdraws it. A timer is held by its delay, all a timer says of itself, so
 * any other of that delay set meanwhile is held with it, and **A HOLD THAT HELD NONE HELD NOTHING**: the caller asserts
 * the count.
 */
async function holdingNotices(act: () => Promise<void>): Promise<number> {
  const set = window.setTimeout
  let count = 0
  window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (ms !== NOTICE_MS) return set(handler, ms, ...args)
    count += 1
    return 0
  }) as typeof window.setTimeout
  try {
    await act()
  } finally {
    window.setTimeout = set
  }
  return count
}

/** The `fact(4)` example picked from `examples ▾`, which draws a notice with its undo. */
async function pickFact(): Promise<void> {
  await userEvent.click(document.querySelector('#examples') as HTMLElement)
  const fact = [...document.querySelectorAll<HTMLElement>('button.example')].find((b) =>
    /^fact\(4\)/.test(b.textContent ?? ''),
  )
  await userEvent.click(fact as HTMLElement)
}

/** The program session idle and no view recording. */
const settled = () =>
  until(() => stateIdle() && LEAVES.every((leaf) => !stepTextOf(leaf).includes('…')), 'the compile to settle')

const forward = (leaf: string) =>
  document.querySelector(`[data-leaf="${leaf}"] .controls button[aria-label="${FORWARD}"]`) as HTMLButtonElement

/**
 * Every view stepped on three steps, off step 0, so the old build's picture differs from the new one's step 0; then
 * `act`, the replies handed over one a frame from the new build's `compiled` to its `result`, every frame sampled.
 */
async function recompile(act: () => Promise<void>): Promise<{ before: Sample; samples: Sample[] }> {
  await settled()
  for (const leaf of LEAVES) for (let i = 0; i < 3; i += 1) await userEvent.click(forward(leaf))
  await frames()
  const before = read()
  expect(
    LEAVES.every((leaf) => before.lines[LEAVES.indexOf(leaf)]?.startsWith('step 3 of')),
    `precondition: every view at step 3, ${before.lines}`,
  ).toBe(true)
  const stop = sampling()
  held = []
  await act()
  await until(() => held?.some((r) => r.kind === 'compiled') ?? false, 'the new build’s compiled reply')
  let ended = false
  for (let n = 0; !ended || (held?.length ?? 0) > 0; n += 1) {
    if (n > 5_000) throw new Error('the new build’s replies did not end')
    const next = held?.shift()
    if (next === undefined) {
      await frame()
      continue
    }
    if (next.kind === 'result') ended = true
    next.hand()
    await frames()
  }
  held = null
  await frames()
  return { before, samples: stop() }
}

/**
 * What each sample of `samples` shows emptied, as flat text or `not run`, with the number of frames that showed it, and
 * the rules panel's tops if it stood anywhere but the old program's and then the new one's: `[]` when no frame did.
 * **THE TOP MAY CHANGE ONCE**, from the old program's to the new one's, since two programs' TM views can differ above
 * the panel; any other top is a frame drawn between the two.
 */
function flashes(before: Sample, samples: readonly Sample[]): string[] {
  const lineOf = (s: Sample, leaf: Leaf) => s.lines[LEAVES.indexOf(leaf)] ?? ''
  expect(samples.length, 'precondition: frames were sampled').toBeGreaterThan(10)
  expect(
    samples.some((s) => LEAVES.every((leaf) => lineOf(s, leaf).startsWith('step 0 of'))),
    'precondition: a sampled frame shows every view at the new step 0',
  ).toBe(true)
  const found = new Map<string, number>()
  for (const s of samples) {
    const what = [
      s.tapes < 1 ? 'no TM tape rows' : '',
      s.registers < 1 ? 'no rxm registers' : '',
      s.layout === 'flat' ? 'the λ term as flat text' : '',
      ...LEAVES.filter((leaf) => lineOf(s, leaf) === 'not run').map((leaf) => `${leaf} not run`),
    ].filter((w) => w !== '')
    for (const w of what) found.set(w, (found.get(w) ?? 0) + 1)
  }
  const tops = [before, ...samples].map((s) => s.rulesTop).filter((top, i, all) => i === 0 || top !== all[i - 1])
  const settled = samples.at(-1)?.rulesTop
  const moved = tops.length > 2 || (tops.length === 2 && tops[1] !== settled)
  // The TM step line of each frame the panel stood elsewhere: a line that wraps moves the panel too.
  const elsewhere = samples
    .filter((s) => s.rulesTop !== before.rulesTop && s.rulesTop !== settled)
    .map((s) => s.lines[2])
  const where = moved ? [`the TM rules panel at ${tops}, under ${[...new Set(elsewhere)].join(' | ')}`] : []
  return [...[...found].map(([what, n]) => `${what} (${n} frames)`), ...where]
}

describe('a recompile, in the app with the λ, rxm and TM views and their panels open', () => {
  beforeAll(async () => {
    globalThis.Worker = new Proxy(PageWorker, {
      construct(target, args: ConstructorParameters<typeof Worker>, newTarget) {
        const worker: Worker = Reflect.construct(target, args, newTarget)
        if (String(args[0]).includes('session-worker'))
          worker.addEventListener('message', (e) => hold(worker, e as MessageEvent))
        return worker
      },
    })
    await page.viewport(1600, 1000)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await showWideDefault()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SRC } })
    await settled()
    const closed = (leaf: string) => [
      ...paneByLeaf(leaf).querySelectorAll<HTMLElement>('button.panel-toggle[aria-expanded="false"]'),
    ]
    for (const leaf of LEAVES) for (const toggle of closed(leaf)) await userEvent.click(toggle)
    expect(
      LEAVES.map((leaf) => closed(leaf).length),
      'precondition: every panel open',
    ).toEqual([0, 0, 0])
  }, 60_000)
  // A CASE THAT FAILS WHILE IT HOLDS THE REPLIES WOULD LEAVE THE NEXT ONE'S RUN NEVER ARRIVING.
  afterEach(() => {
    const replies = held ?? []
    held = null
    for (const reply of replies) reply.hand()
  })
  afterAll(() => {
    globalThis.Worker = PageWorker
  })

  it('swaps in one frame on a typed edit', async () => {
    const { before, samples } = await recompile(async () => {
      const at = view.state.doc.toString().lastIndexOf('5)') + 1
      view.dispatch({ selection: { anchor: at } })
      view.focus()
      await userEvent.keyboard('{Backspace}4')
    })
    expect(flashes(before, samples)).toEqual([])
  }, 60_000)

  it('swaps in one frame on a change of encoding', async () => {
    const { before, samples } = await recompile(() => userEvent.selectOptions(picker(), 'unary'))
    expect(flashes(before, samples)).toEqual([])
    await userEvent.selectOptions(picker(), 'binary')
  }, 60_000)

  it('swaps in one frame on an example', async () => {
    const { before, samples } = await recompile(pickFact)
    expect(flashes(before, samples)).toEqual([])
  }, 60_000)

  /**
   * **ITS OWN PICK, WITH THE PICK'S NOTICE HELD**: the undo is that notice's action, and between the pick and the
   * press the case settles the pick's compile and steps every view (`holdingNotices`). The pick is made over `SRC`, so
   * the undo puts back a program that is not the example's, whatever the case before left.
   */
  it('swaps in one frame on the example’s undo', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SRC } })
    expect(await holdingNotices(pickFact), 'precondition: the pick’s notice held').toBe(1)
    const { before, samples } = await recompile(() => userEvent.click(undoButton() as HTMLButtonElement))
    expect(flashes(before, samples)).toEqual([])
  }, 60_000)

  /**
   * **THE LINK CARRIES EVERY VIEW AT STEP 3**, so each view's position lies past the step 0 `compiled` carries, and a
   * view waits on its leg's first chunk to go there: the TM view behind the λ and rxm recordings.
   */
  it('swaps in one frame on a shared link’s open', async () => {
    // FROM `SRC`'S STEP 0, WHATEVER THE CASE BEFORE LEFT: three steps from any other step would carry the link past 3.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SRC } })
    await settled()
    for (const leaf of LEAVES) for (let i = 0; i < 3; i += 1) await userEvent.click(forward(leaf))
    await frames()
    await userEvent.click(document.querySelector('#share') as HTMLElement)
    await until(() => document.querySelector<HTMLInputElement>('#share-link')?.value.includes('#') ?? false, 'the link')
    const link = (document.querySelector('#share-link') as HTMLInputElement).value
    await userEvent.keyboard('{Escape}')
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SRC.replace('sum_to(5)', 'sum_to(3)') } })
    await settled()
    const { before, samples } = await recompile(async () => {
      location.hash = new URL(link).hash
    })
    expect(
      samples.at(-1)?.lines.map((l) => l.replace(/ of .*/, '')),
      'precondition: the link took every view to step 3',
    ).toEqual(['step 3', 'step 3', 'step 3'])
    expect(flashes(before, samples)).toEqual([])
  }, 60_000)

  /**
   * **↺ ON A VIEW WAITING FOR ITS LEG'S FIRST CHUNK LEAVES IT ON STEP 0**, as ↺ does anywhere: the ring holds only the
   * step 0 `compiled` carried, and the chunks that come after the press do not carry the view on with them.
   */
  it('leaves a view on step 0 when ↺ is pressed while it waits for its first chunk', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SRC } })
    await settled()
    held = []
    const at = view.state.doc.toString().lastIndexOf('5)') + 1
    view.dispatch({ selection: { anchor: at } })
    view.focus()
    await userEvent.keyboard('{Backspace}4')
    await until(() => held?.some((r) => r.kind === 'compiled') ?? false, 'the new build’s `compiled` reply')
    for (let next = held?.shift(); next !== undefined; next = held?.shift()) {
      next.hand()
      if (next.kind === 'compiled') break
    }
    await frames()
    const restart = document.querySelector<HTMLButtonElement>(
      '[data-leaf="tm-0"] .controls button[aria-label="back to step 0"]',
    ) as HTMLButtonElement
    expect(
      [stepTextOf('tm-0'), restart.disabled || restart.getAttribute('aria-disabled') === 'true'],
      'precondition: the TM view waits on its first chunk, ↺ live',
    ).toEqual(['step 0 of 0…', false])
    await userEvent.click(restart)
    for (let n = 0; !stateIdle() || (held?.length ?? 0) > 0; n += 1) {
      if (n > 5_000) throw new Error('the new build’s replies did not end')
      const next = held?.shift()
      if (next === undefined) await frame()
      else {
        next.hand()
        await frames()
      }
    }
    held = null
    await settled()
    expect(stepTextOf('tm-0')).toMatch(/^step 0 of [1-9]/)
  }, 60_000)
})
