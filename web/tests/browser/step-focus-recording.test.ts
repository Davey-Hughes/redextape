import type { EditorView } from '@codemirror/view'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { controlName, historyFills, resetToFirstLoad, SHELL, settledFocus, tmStepText, until } from './harness'
import { viewKey } from './user-event-fixture'

/**
 * `extend-during-recompile.test.ts`'s `BUDGET_SRC` over a list four times as long, so that the TM leg stops
 * `budget` again after a "keep recording" rather than running the program to its end.
 */
const LONG_SRC =
  'fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2, 4, 3, 1, 2, 4, 3, 1, 2, 4, 3, 1, 2, 4].map(add1)'

const BACK = 'one step back'
const FORWARD = 'one step forward'
const NEWEST = 'to the newest recorded step'

let view: EditorView

/**
 * The session workers' replies the page has not been handed yet, or `null` while they reach it as they come. **SO THAT
 * A STATE THE PAGE PASSES THROUGH WHILE IT RECORDS HOLDS STILL** for a gesture or a read, where the worker can fill the
 * history faster than a gesture lands. The worker records on; the page sees a slower one. **THE LANGUAGE SERVER'S
 * REPLIES ARE NOT HELD**: one landing first would meet a wait for the recording's first batch and be all `release` hands
 * over.
 */
let held: (() => void)[] | null = null

/** The page's own `Worker`: `beforeAll` wraps it so that the session replies can be held, and `afterAll` puts it back. */
const PageWorker = globalThis.Worker

/** The copies of held replies that `release` hands the page, which the hold lets through. */
const handed = new WeakSet<Event>()

/**
 * Holds a session worker's reply while `held` is a list. **ONE LISTENER, THE WORKER'S FIRST**, which stops a reply
 * before the app's and later dispatches a copy, so the app's own listeners are added and removed untouched.
 */
const hold = (worker: Worker, e: MessageEvent): void => {
  if (held === null || handed.has(e)) return
  e.stopImmediatePropagation()
  held.push(() => {
    const copy = new MessageEvent('message', { data: e.data })
    handed.add(copy)
    worker.dispatchEvent(copy)
  })
}

/** Hand the page the replies held so far; `then` is whether to go on holding the ones after them. */
const release = (then: 'hold' | 'let through') => {
  const replies = held ?? []
  held = then === 'hold' ? [] : null
  for (const reply of replies) reply()
}

const strip = () => document.querySelector('[data-leaf="tm-0"] .controls') as HTMLElement
const button = (name: string) => strip().querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement

/** The readout's step and its newest step. */
const at = (): { step: number; of: number } => {
  const m = /^step ([\d,]+) of ([\d,]+)/.exec(tmStepText())
  if (m === null) throw new Error(`no step in "${tmStepText()}"`)
  return { step: Number(m[1]?.replaceAll(',', '')), of: Number(m[2]?.replaceAll(',', '')) }
}

/** Each new value `read` gives, read every frame until the returned function is called, which answers them. */
const watch = (read: () => string): (() => string[]) => {
  const seen: string[] = []
  let on = true
  const look = () => {
    if (!on) return
    const now = read()
    if (seen.at(-1) !== now) seen.push(now)
    requestAnimationFrame(look)
  }
  look()
  return () => {
    on = false
    return seen
  }
}

/**
 * **A RECORDING IS WAITED ON IN STAGES OF THIS MANY STEPS**, each within `until`'s one bound, as `harness.ts`'s
 * `historyFills` waits on a fill in halves: a stage that records nothing fails where a single long wait would not.
 */
const STAGE = 37_000

/** A `budget` stop with the recording over, past step `before`. */
const stoppedPast = async (before: number): Promise<void> => {
  const stopped = () => tmStepText().includes('history is full') && !tmStepText().includes('…') && at().of > before
  for (let from = before; !stopped(); from = at().of)
    await until(() => stopped() || at().of >= from + STAGE, `the recording past step ${from} to stop \`budget\``)
}

/**
 * **A `▶` OR `⏭` THAT A RECORDING TURNS OFF UNDER THE FOCUS WAITS FOR IT WITH THE FOCUS** (`step-controls.ts`), in the
 * app with the worker recording, and `[keep recording]` hands the focus to a waiting `▶`. Where the recording stops
 * `budget`, the focus is on a live `▶`, as after `⏭` at a run already stopped there, and the next Enter records further.
 */
describe('a step button a recording turns off under the focus, in the app', () => {
  beforeAll(async () => {
    globalThis.Worker = new Proxy(PageWorker, {
      construct(target, args: ConstructorParameters<typeof Worker>, newTarget) {
        const worker: Worker = Reflect.construct(target, args, newTarget)
        if (String(args[0]).includes('session-worker'))
          worker.addEventListener('message', (e) => hold(worker, e as MessageEvent))
        return worker
      },
    })
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })
  // A TEST THAT FAILS WHILE IT HOLDS THE REPLIES WOULD LEAVE THE NEXT ONE'S RUN NEVER ARRIVING.
  afterEach(() => release('let through'))
  afterAll(() => {
    globalThis.Worker = PageWorker
  })

  it('lets the app take back a listener it gave a session worker, while replies are held and after', async () => {
    const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
    try {
      let heard = 0
      const listener = () => {
        heard += 1
      }
      worker.addEventListener('message', listener)
      worker.removeEventListener('message', listener)
      held = []
      worker.dispatchEvent(new MessageEvent('message', { data: null }))
      release('let through')
      worker.dispatchEvent(new MessageEvent('message', { data: null }))
      expect(heard, 'what the listener taken back heard').toBe(0)
    } finally {
      worker.terminate()
    }
  })

  it('⏭ at a `budget` stop hands the focus to ▶, which by Enter keeps it while it records; Enter at the stop records further', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: LONG_SRC } })
    await historyFills()
    await userEvent.click(button(NEWEST))
    expect(await settledFocus(), 'where the focus settles after ⏭ at the `budget` stop').toBe(FORWARD)
    const first = at()
    expect(first.step, 'precondition: the head at the frontier').toBe(first.of)

    held = []
    await userEvent.keyboard('{Enter}')
    await until(() => (held?.length ?? 0) > 0, 'the recording the Enter asked for to start')
    release('hold')
    await until(() => tmStepText().includes('…'), 'the page to show it recording')
    expect(await settledFocus(), 'where the focus settles while it records').toBe(FORWARD)
    expect(button(FORWARD).ariaDisabled, '▶ waits while it records').toBe('true')
    const focus = watch(() => controlName(document.activeElement))

    release('let through')
    await stoppedPast(first.of)
    expect(focus(), 'what held the focus from then to the stop').toEqual([FORWARD])
    expect(button(FORWARD).disabled || button(FORWARD).ariaDisabled !== null, '▶ is live at the stop').toBe(false)
    const stopped = at()
    expect(stopped.step, 'precondition: the head followed the recording').toBe(stopped.of)

    await userEvent.keyboard('{Enter}')
    await until(() => at().of > stopped.of, 'the Enter at the stop to record further')
  }, 90_000)

  it('⏭ clicked while it records waits, and hands the focus to ▶ at its `budget` stop, where Enter records further', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: `${LONG_SRC} ` } })
    await until(() => tmStepText().includes('…'), 'the first recording to start')
    held = []
    await userEvent.click(button(NEWEST))
    expect(tmStepText(), 'precondition: the click landed while the page knew it to be recording').toContain('…')
    expect(await settledFocus(), 'where the focus settles while it records').toBe(NEWEST)
    expect(button(NEWEST).ariaDisabled, '⏭ waits while it records').toBe('true')
    const focus = watch(() => controlName(document.activeElement))

    release('let through')
    await stoppedPast(0)
    expect(await settledFocus(), 'where the focus settles at the stop').toBe(FORWARD)
    expect(focus(), 'what held the focus from the click until it settled').toEqual([NEWEST, FORWARD])
    expect(button(NEWEST).disabled, '⏭ is off at the `budget` stop').toBe(true)
    const stopped = at()
    expect(stopped.step, 'precondition: the head followed the recording').toBe(stopped.of)

    await userEvent.keyboard('{Enter}')
    await until(() => at().of > stopped.of, 'the Enter at the stop to record further')
  }, 90_000)

  it('[keep recording] by Enter hands the focus to ▶, which waits while it records; Enter at the next stop records further', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: `${LONG_SRC}  ` } })
    await historyFills()
    await userEvent.click(button(NEWEST))
    const extend = strip().querySelector('button.extend') as HTMLButtonElement
    extend.focus()
    expect(document.activeElement, 'precondition: the continue button holds the focus').toBe(extend)
    expect(extend.textContent, 'precondition: the continue button at a `budget` stop').toBe('keep recording')
    const first = at()
    expect(first.step, 'precondition: the head at the frontier').toBe(first.of)

    held = []
    await userEvent.keyboard('{Enter}')
    await until(() => (held?.length ?? 0) > 0, 'the recording the Enter asked for to start')
    release('hold')
    await until(() => tmStepText().includes('…'), 'the page to show it recording')
    expect(await settledFocus(), 'where the focus settles while it records').toBe(FORWARD)
    expect(button(FORWARD).ariaDisabled, '▶ waits while it records').toBe('true')
    const focus = watch(() => controlName(document.activeElement))

    release('let through')
    await stoppedPast(first.of)
    expect(focus(), 'what held the focus from then to the stop').toEqual([FORWARD])
    expect(button(FORWARD).disabled || button(FORWARD).ariaDisabled !== null, '▶ is live at the stop').toBe(false)
    const stopped = at()
    expect(stopped.step, 'precondition: the head followed the recording').toBe(stopped.of)

    await userEvent.keyboard('{Enter}')
    await until(() => at().of > stopped.of, 'the Enter at the stop to record further')
  }, 90_000)

  /**
   * **A REBUILD THAT GIVES THE FOCUS BACK KEEPS A WAITING `⏭` FOCUSED AND WAITING** (`pane-host.ts`'s `keepingFocus`):
   * a divider's drag and a view key. Each starts from the source and TM views side by side, and `⏭` clicked while the
   * page shows a recording. At the stop `⏭` hands the focus to `▶`, as it does where nothing was rebuilt.
   */
  const waitingNewest = async (src: string): Promise<void> => {
    await page.viewport(1280, 896)
    await resetToFirstLoad()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
    await until(() => tmStepText().includes('…'), 'the first recording to start')
    held = []
    await userEvent.click(button(NEWEST))
    expect(tmStepText(), 'precondition: the click landed while the page knew it to be recording').toContain('…')
    expect(await settledFocus(), 'precondition: where the focus settles while it records').toBe(NEWEST)
    expect(button(NEWEST).ariaDisabled, 'precondition: ⏭ waits while it records').toBe('true')
  }

  /** The stop past the rebuild: the focus on `▶`, where Enter records further. `focus` is the watch begun before it. */
  const stopsOnForward = async (focus: () => string[]): Promise<void> => {
    release('let through')
    await stoppedPast(0)
    expect(await settledFocus(), 'where the focus settles at the stop').toBe(FORWARD)
    expect(focus(), 'what held the focus from the rebuild until it settled').toEqual([NEWEST, FORWARD])
    const stopped = at()
    expect(stopped.step, 'precondition: the head followed the recording').toBe(stopped.of)
    await userEvent.keyboard('{Enter}')
    await until(() => at().of > stopped.of, 'the Enter at the stop to record further')
  }

  /** The layout's one divider, dragged 80 px along its split by the driver's pointer. */
  const dragDivider = async (): Promise<void> => {
    const divider = document.querySelector('#views .layout-divider') as HTMLElement
    const views = document.querySelector('#views') as HTMLElement
    const [at, area] = [divider.getBoundingClientRect(), views.getBoundingClientRect()]
    const before = divider.getAttribute('aria-valuenow')
    await userEvent.dragAndDrop(divider, views, {
      targetPosition: { x: at.left - area.left + 80, y: at.top - area.top + at.height / 2 },
    })
    const after = document.querySelector('#views .layout-divider')?.getAttribute('aria-valuenow')
    expect(after, 'precondition: the drag moved the divider').not.toBe(before)
  }

  it('⏭ waiting through a divider’s drag keeps the focus and waits on; at its `budget` stop Enter records further', async () => {
    await waitingNewest(`${LONG_SRC}   `)
    const focus = watch(() => controlName(document.activeElement))
    await dragDivider()
    expect(await settledFocus(), 'where the focus settles after the drag').toBe(NEWEST)
    expect(button(NEWEST).ariaDisabled, '⏭ waits on after the drag').toBe('true')
    expect(button(NEWEST).disabled, '⏭ is not disabled after the drag').toBe(false)
    await stopsOnForward(focus)

    await userEvent.tab({ shift: true })
    expect(await settledFocus(), 'precondition: Shift+Tab from ▶ reaches a live ◀').toBe(BACK)
    await dragDivider()
    expect(await settledFocus(), 'where the focus on ◀ settles after the drag').toBe(BACK)
  }, 90_000)

  it('⏭ waiting through a view key keeps the focus and waits on; at its `budget` stop Enter records further', async () => {
    await waitingNewest(`${LONG_SRC}    `)
    const newest = button(NEWEST)
    const focus = watch(() => controlName(document.activeElement))
    await viewKey(']')
    expect(newest.isConnected, 'precondition: the next layout keeps the TM view').toBe(true)
    expect(await settledFocus(), 'where the focus settles after the view key').toBe(NEWEST)
    expect(newest.ariaDisabled, '⏭ waits on after the view key').toBe('true')
    expect(newest.disabled, '⏭ is not disabled after the view key').toBe(false)
    await stopsOnForward(focus)
  }, 90_000)

  /**
   * **A REBUILD THAT TAKES THE WAITING `⏭` OFF THE PAGE ENDS ITS WAIT**: given no focus back, it hears no `blur` the
   * rebuild sends (`focus-handoff.ts`'s `keepFocusOn`); its page watch ends the wait at the next microtask checkpoint.
   */
  it('⏭ waiting when a view key hides its view stops waiting, and is no Tab stop when the view is back', async () => {
    await waitingNewest(`${LONG_SRC}     `)
    const newest = button(NEWEST)
    await viewKey('4')
    expect(newest.isConnected, 'precondition: the key took the TM view off the page').toBe(false)
    expect(newest.ariaDisabled, '⏭ off the page does not wait').toBe(null)
    expect(newest.disabled, '⏭ off the page is disabled').toBe(true)
    expect(await settledFocus(), 'where the focus settles once the TM view has gone').not.toBe('BODY')
    await viewKey('4')
    expect(button(NEWEST), 'precondition: the key put the same TM view back').toBe(newest)
    button(BACK).focus()
    await userEvent.tab()
    expect(await settledFocus(), 'where Tab from ◀ goes').toBe('play')
  }, 90_000)
})

describe('the hold on the session workers, once the cases above are done', () => {
  it('has given the page its own `Worker` back, its prototype untouched', () => {
    expect(globalThis.Worker, 'the constructor').toBe(PageWorker)
    expect(Worker.prototype.addEventListener, 'what adds a listener').toBe(EventTarget.prototype.addEventListener)
  })
})
