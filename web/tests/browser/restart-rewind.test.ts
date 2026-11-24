import type { EditorView } from '@codemirror/view'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import {
  alphaOf,
  frames,
  historyFills,
  recorded,
  SHELL,
  segments,
  settledFocus,
  showWideDefault,
  stepTextOf,
  until,
} from './harness'

/** `step-focus-recording.test.ts`'s program: its TM leg stops `budget` again after a "keep recording". */
const LONG_SRC =
  'fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2, 4, 3, 1, 2, 4, 3, 1, 2, 4, 3, 1, 2, 4].map(add1)'

/** The `fact` example, which the CLIF leg builds. */
const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''

/** The hidden-recording spec's example, whose rxm run is longer than one history. */
const EXAMPLE = 'let mut n = 100000; while n > 0 { n = n - 1; } n'

const RESTART = 'back to step 0'
const FORWARD = 'one step forward'
const NEWEST = 'to the newest recorded step'

let view: EditorView

/** A session worker's reply not yet handed to the page, with its kind and leg, so a wait can name what it holds. */
type Held = { readonly kind: string; readonly leg: unknown; readonly hand: () => void }

/**
 * The session workers' replies the page has not been handed yet, or `null` while they reach it as they come, **SO THAT
 * A STATE THE PAGE PASSES THROUGH WHILE A LEG RECORDS HOLDS STILL** for a gesture or a read. The worker records on; the
 * page sees a slower one. **THE LANGUAGE SERVER'S REPLIES ARE NOT HELD**: they move no step line, button or readout,
 * the states held still here.
 */
let held: Held[] | null = null

/**
 * The `result` replies the page has been handed. **THE READOUT'S λ SEGMENT COMES FROM A `result` ALONE**, a message of
 * its own after the frames whose end the step line shows, and `until` polls on a timer that can run between the two.
 */
let resultsIn = 0

/** The page's own `Worker`: `beforeAll` wraps it so that the session replies can be held, and `afterAll` puts it back. */
const PageWorker = globalThis.Worker

/** The copies of held replies that `release` hands the page, which the hold lets through. */
const handed = new WeakSet<Event>()

/**
 * Holds a session worker's reply while `held` is a list, and counts the `result`s it lets reach the page. **ONE
 * LISTENER, THE WORKER'S FIRST**, which stops a reply before the app's and later dispatches a copy, so the app's own
 * listeners are added and removed untouched.
 */
const hold = (worker: Worker, e: MessageEvent): void => {
  if (held === null || handed.has(e)) {
    if (e.data?.kind === 'result') resultsIn += 1
    return
  }
  e.stopImmediatePropagation()
  held.push({
    kind: String(e.data?.kind),
    leg: e.data?.leg,
    hand: () => {
      const copy = new MessageEvent('message', { data: e.data })
      handed.add(copy)
      worker.dispatchEvent(copy)
    },
  })
}

/** Hand the page the replies held so far; `then` is whether to go on holding the ones after them. */
const release = (then: 'hold' | 'let through') => {
  const replies = held ?? []
  held = then === 'hold' ? [] : null
  for (const reply of replies) reply.hand()
}

/** Hand the page the held replies up to the first of `kind` on `leg`, that one included, and go on holding the rest. */
const releaseThrough = (kind: string, leg: string) => {
  const replies = held ?? []
  const upTo = replies.findIndex((r) => r.kind === kind && r.leg === leg) + 1
  held = replies.slice(upTo)
  for (const reply of replies.slice(0, upTo)) reply.hand()
}

const line = (leaf: string) => stepTextOf(leaf)
const button = (leaf: string, name: string) =>
  document.querySelector(`[data-leaf="${leaf}"] .controls button[aria-label="${name}"]`) as HTMLButtonElement
const extendOf = (leaf: string) =>
  document.querySelector(`[data-leaf="${leaf}"] .controls button.extend`) as HTMLButtonElement
const lambdaSegment = () => segments().find((s) => s.startsWith('λ')) ?? ''

/** A view's step and its newest step. */
const at = (leaf: string): { step: number; of: number } => {
  const m = /^step ([\d,]+) of ([\d,]+)/.exec(line(leaf))
  if (m === null) throw new Error(`no step in ${leaf}'s "${line(leaf)}"`)
  return { step: Number(m[1]?.replaceAll(',', '')), of: Number(m[2]?.replaceAll(',', '')) }
}

/** The oldest step `leaf`'s view keeps, read from its line's `(oldest kept: step N)`. */
const oldestKept = (leaf: string): number =>
  Number(/\(oldest kept: step ([\d,]+)\)/.exec(line(leaf))?.[1]?.replaceAll(',', '') ?? Number.NaN)

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

/** A `budget` stop of `leaf`'s recording, with the recording over, past step `before`; `what` names the recording. */
const stoppedPast = async (leaf: string, before: number, what = 'recording'): Promise<void> => {
  const stopped = () => line(leaf).includes('history is full') && !line(leaf).includes('…') && at(leaf).of > before
  for (let from = before; !stopped(); from = at(leaf).of)
    await until(() => stopped() || at(leaf).of >= from + STAGE, `${leaf}'s ${what} past step ${from} to stop`)
}

/** `leaf`'s line back on `first`, its first fill's, waited on in stages while the rewind records the fill again. */
const refills = async (leaf: string, first: string): Promise<void> => {
  for (let from = 0; line(leaf) !== first; from = at(leaf).of)
    await until(
      () => line(leaf) === first || at(leaf).of >= from + STAGE,
      `${leaf} past step ${from} to read "${first}"`,
    )
}

/**
 * `src` compiled fresh, its TM history full, the λ and rxm views done recording and the compile's `result` in: each
 * view's first-fill line. **THE `result` IS WAITED ON HERE** because the worker posts it after the frames that fill the
 * TM history, so a case's count of `result`s started before it lands would rise on it rather than on the case's own.
 */
const compiled = async (src: string): Promise<Record<'tm' | 'rxm' | 'lambda', string>> => {
  const before = resultsIn
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await historyFills()
  await until(() => resultsIn > before, 'the compile’s result')
  const first = { tm: line('tm-0'), rxm: line('rxm-0'), lambda: line('lambda-0') }
  for (const [leg, l] of Object.entries(first)) {
    expect(l, `precondition: the ${leg} view at step 0`).toMatch(/^step 0 of /)
    expect(l, `precondition: the ${leg} view's first fill is over`).not.toContain('…')
  }
  return first
}

/** Each of `leaves`' lines, by leaf. */
const linesOf = (leaves: readonly string[]) => Object.fromEntries(leaves.map((l) => [l, line(l)]))

/**
 * Each of `leaves` stepped to step 3 by three clicks on its ▶, and their lines. **OFF STEP 0, A VIEW SHOWS WHETHER A
 * REWIND OF ANOTHER MOVED IT**: on its first-fill line at step 0, a rewind of it would land on that line again.
 */
const stepped = async (leaves: readonly string[]): Promise<Record<string, string>> => {
  for (const leaf of leaves) for (let i = 0; i < 3; i += 1) await userEvent.click(button(leaf, FORWARD))
  expect(
    leaves.map((l) => at(l).step),
    `precondition: three clicks stepped ${leaves.join(' and ')}`,
  ).toEqual(leaves.map(() => 3))
  return linesOf(leaves)
}

/** `compiled`, then the TM view's step 0 dropped by a "keep recording" to its next `budget` stop. */
const dropsStepZero = async (src: string): Promise<Record<'tm' | 'rxm' | 'lambda', string>> => {
  const first = await compiled(src)
  await userEvent.click(extendOf('tm-0'))
  await stoppedPast('tm-0', at('tm-0').of)
  expect(line('tm-0'), 'precondition: the TM view dropped its step 0').toContain('(oldest kept: step')
  return first
}

/**
 * **↺ GOES TO STEP 0 OF ITS OWN VIEW**, in the app with all four views and the worker recording: where the view's step
 * 0 was dropped it records the leg's first fill again, and every other view keeps its place (hidden-recording spec
 * §4.1). Each case compiles its own program, so that its first fills are its own, and reads each view's first-fill line
 * before it acts, so that the rewound fill is held to the line the leg showed rather than to a count written here.
 */
describe('↺ back to step 0, in the app', () => {
  beforeAll(async () => {
    globalThis.Worker = new Proxy(PageWorker, {
      construct(target, args: ConstructorParameters<typeof Worker>, newTarget) {
        const worker: Worker = Reflect.construct(target, args, newTarget)
        if (String(args[0]).includes('session-worker'))
          worker.addEventListener('message', (e) => hold(worker, e as MessageEvent))
        return worker
      },
    })
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await showWideDefault()
  })
  // A TEST THAT FAILS WHILE IT HOLDS THE REPLIES WOULD LEAVE THE NEXT ONE'S RUN NEVER ARRIVING.
  afterEach(() => release('let through'))
  afterAll(() => {
    globalThis.Worker = PageWorker
  })

  it('↺ on the TM view whose step 0 was dropped records its first fill again; the rxm and λ views keep their steps, and ↺ on the rxm view, its step 0 kept, seeks', async () => {
    const first = await dropsStepZero(LONG_SRC)
    const others = await stepped(['rxm-0', 'lambda-0'])

    await userEvent.click(button('tm-0', RESTART))
    await refills('tm-0', first.tm)
    expect(linesOf(['rxm-0', 'lambda-0']), 'the other views after the TM rewind').toEqual(others)

    held = []
    await userEvent.click(button('rxm-0', RESTART))
    expect(line('rxm-0'), 'the rxm view at once after its ↺, with the replies held').toBe(first.rxm)
  }, 90_000)

  it('↺ on the λ view whose run ended past a dropped step 0 records its first fill again, and the readout keeps the λ value', async () => {
    const first = await compiled(`${LONG_SRC} `)
    expect(first.lambda, 'precondition: the λ history is full').toContain('history is full')
    while (line('lambda-0').includes('history is full')) {
      const before = resultsIn
      await userEvent.click(extendOf('lambda-0'))
      await until(() => resultsIn > before, 'the result after the λ view’s "keep recording"')
    }
    expect(line('lambda-0'), 'precondition: the λ run ended past its dropped step 0').toMatch(
      /^step [\d,]+ of [\d,]+ \(oldest kept: step [\d,]+\)$/,
    )
    await until(() => lambdaSegment().startsWith('λ ['), 'the readout to name the λ value')
    const value = lambdaSegment()
    const others = await stepped(['tm-0', 'rxm-0'])

    await userEvent.click(button('lambda-0', RESTART))
    await until(() => line('lambda-0') === first.lambda, 'the λ view back on its first-fill line')
    expect(linesOf(['tm-0', 'rxm-0']), 'the other views after the λ rewind').toEqual(others)
    const before = resultsIn
    await userEvent.click(extendOf('tm-0'))
    await stoppedPast('tm-0', at('tm-0').of)
    await until(() => resultsIn > before, 'the result after the TM view’s "keep recording"')
    expect(lambdaSegment(), 'the readout’s λ segment after the λ rewind and a TM result').toBe(value)
  }, 90_000)

  it('↺ on the rxm view whose step 0 was dropped records its first fill again, and *keep recording* and ▶ at its newest step record on from it', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: EXAMPLE } })
    await until(() => line('rxm-0').includes('…') || line('rxm-0').includes('history is full'), 'the rxm leg to record')
    expect(line('rxm-0'), 'precondition: the rxm leg is past the recompile').not.toContain('— recompiling')
    await stoppedPast('rxm-0', 0)
    const first = line('rxm-0')
    expect(at('rxm-0').step, 'precondition: the rxm view at step 0').toBe(0)

    await userEvent.click(extendOf('rxm-0'))
    await stoppedPast('rxm-0', at('rxm-0').of)
    expect(line('rxm-0'), 'precondition: the rxm view dropped its step 0').toContain('(oldest kept: step')

    await userEvent.click(button('rxm-0', RESTART))
    await refills('rxm-0', first)

    // **EACH CONTINUE OF THE REWOUND LEG CARRIES ITS NEW EPOCH**: the worker drops one without it, and nothing answers.
    await userEvent.click(extendOf('rxm-0'))
    await stoppedPast('rxm-0', at('rxm-0').of, 'recording from *keep recording* after the rewind')
    await userEvent.click(button('rxm-0', NEWEST))
    expect(at('rxm-0').step, 'precondition: the view at its newest step').toBe(at('rxm-0').of)
    await userEvent.click(button('rxm-0', FORWARD))
    await stoppedPast('rxm-0', at('rxm-0').of, 'recording from ▶ at its newest step after the rewind')
  }, 90_000)

  it('⏵ plays on from step 0 across a rewind, ⏸ off until the first frames come', async () => {
    const first = await dropsStepZero(`${LONG_SRC}  `)
    const speed = document.querySelector('[data-leaf="tm-0"] .controls select.speed') as HTMLSelectElement
    const was = speed.value
    await userEvent.selectOptions(speed, '60')
    expect(speed.value, 'precondition: the TM view plays at 60/s').toBe('60')
    await userEvent.click(button('tm-0', 'play'))
    expect(button('tm-0', 'pause'), 'precondition: the TM leg plays').not.toBe(null)

    held = []
    await userEvent.click(button('tm-0', RESTART))
    await frames()
    await frames()
    expect(line('tm-0'), 'the TM line while the first frames are held').toBe('step 0 of 0…')
    expect(button('tm-0', 'pause')?.disabled, '⏸ while the first frames are held').toBe(true)

    release('let through')
    await until(() => at('tm-0').step >= 1, 'the TM view to play on from step 0')
    expect(line('tm-0'), 'the TM view playing on while the rewound fill records').toContain('…')
    expect(at('tm-0').of, 'the newest step, of the rewound fill').toBeLessThanOrEqual(recorded(first.tm))
    expect(button('tm-0', 'pause')?.disabled, '⏸ live, the leg still playing').toBe(false)
    await userEvent.click(button('tm-0', 'pause'))
    await userEvent.selectOptions(speed, was)
  }, 90_000)

  it('↺ by Enter waits greyed with the focus while the first frames come, and is live with it once they have', async () => {
    const first = await dropsStepZero(`${LONG_SRC}   `)
    const restart = button('tm-0', RESTART)
    restart.focus()
    expect(document.activeElement, 'precondition: ↺ took the focus').toBe(restart)
    held = []
    await userEvent.keyboard('{Enter}')
    expect(await settledFocus(), 'where the focus settles while the first frames are held').toBe(RESTART)
    expect(document.activeElement, 'what holds the focus while the first frames are held').toBe(restart)
    expect(restart.ariaDisabled, '↺ waits while the first frames are held').toBe('true')
    const faint = Number(getComputedStyle(button('tm-0', FORWARD)).opacity)
    expect(faint, 'precondition: ▶, disabled while the first frames are held, is drawn faint').toBeLessThan(1)
    expect(alphaOf(getComputedStyle(restart).color), '↺ greyed: its glyph as faint as ▶’s').toBeCloseTo(faint, 2)
    expect(line('tm-0'), 'the TM line while the first frames are held').toBe('step 0 of 0…')

    await until(
      () => held?.some((r) => r.kind === 'frames' && r.leg === 'tm') ?? false,
      'the rewind’s first frames to be held',
    )
    releaseThrough('frames', 'tm')
    await until(() => at('tm-0').of > 0, 'the rewind’s first frames on the TM line')
    expect(line('tm-0'), 'precondition: the rewind records on').toContain('…')
    expect(await settledFocus(), 'where the focus settles at the rewind’s first frames').toBe(RESTART)
    expect(document.activeElement, 'what holds the focus at the rewind’s first frames').toBe(restart)
    expect(
      { disabled: restart.disabled, ariaDisabled: restart.ariaDisabled },
      '↺ at the rewind’s first frames',
    ).toEqual({ disabled: false, ariaDisabled: null })

    release('let through')
    await refills('tm-0', first.tm)
    expect(await settledFocus(), 'where the focus settles once the fill is in').toBe(RESTART)
    expect(document.activeElement, 'what holds the focus once the fill is in').toBe(restart)
    expect(restart.ariaDisabled, '↺ is live').toBe(null)
    expect(restart.disabled, '↺ is not disabled').toBe(false)
  }, 90_000)

  it('↺ while the recording that dropped step 0 still brings frames keeps none of them', async () => {
    const first = await compiled(`${LONG_SRC}    `)
    await userEvent.click(extendOf('tm-0'))
    await until(
      () => line('tm-0').includes('(oldest kept:') && line('tm-0').includes('…'),
      'the TM view to drop its step 0 while it records',
    )
    held = []
    await until(
      () => held?.some((r) => r.kind === 'frames' && r.leg === 'tm') ?? false,
      'a frames reply of that recording to be held',
    )
    await userEvent.click(button('tm-0', RESTART))
    const seen = watch(() => line('tm-0'))

    release('let through')
    await refills('tm-0', first.tm)
    const past = seen().filter((l) => recorded(l) > recorded(first.tm))
    expect(past, 'the lines from the ↺ on with a count past the first fill’s').toEqual([])
  }, 90_000)

  /**
   * **↺ DURING A RECOMPILE IS A SEEK**, even with step 0 dropped (hidden-recording spec §6): the program's keystroke
   * claims the new generation at once, and the frames the view holds are the old one's. The replies are held from
   * before the key, so the recompile is still in flight at the click.
   */
  it('↺ during a recompile, on the TM view whose step 0 was dropped, seeks, and the recompile records from step 0', async () => {
    const first = await dropsStepZero(`${LONG_SRC}      `)
    const kept = oldestKept('tm-0')
    await userEvent.click(button('tm-0', NEWEST))
    expect(at('tm-0').step, 'precondition: the view stands past the oldest kept step').toBeGreaterThan(kept)
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    view.focus()
    await until(() => view.hasFocus, 'the program’s editor to take the focus')
    held = []
    await userEvent.keyboard(' ')
    expect(line('tm-0'), 'precondition: the keystroke started a recompile').toContain('— recompiling')

    await userEvent.click(button('tm-0', RESTART))
    expect(
      { step: at('tm-0').step, recompiling: line('tm-0').includes('— recompiling') },
      'the view at once after ↺, the replies held',
    ).toEqual({ step: kept, recompiling: true })
    release('let through')
    await until(
      () => line('tm-0').startsWith('step ') && !line('tm-0').includes('— recompiling'),
      'the recompile’s first TM frames',
    )
    await refills('tm-0', first.tm)
  }, 90_000)

  /**
   * **↺ ON A MACHINE VIEW OF THE PROGRAM RESTARTS IT AND THROWS NOTHING.** Each view is stepped off step 0 before
   * its ↺, so a ↺ that did nothing would leave it there; what the presses threw is read before where they left the
   * views, since a ↺ that throws before it seeks leaves its view where it was.
   */
  it('↺ on the program’s TM, rxm and clif views restarts each at step 0 and throws nothing', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: FACT } })
    const toggle = document.querySelector('#views-shown button[data-shows="clif"]') as HTMLButtonElement
    await userEvent.click(toggle)
    const leaves = ['tm-0', 'rxm-0', 'clif-0']
    const ready = (l: string) => /^step 0 of [\d,]+/.test(line(l)) && !/…|recompiling/.test(line(l))
    await until(() => leaves.every(ready), 'each machine view at step 0, its first fill over')
    const thrown: string[] = []
    const onError = (e: ErrorEvent) => thrown.push(String(e.error ?? e.message))
    const onRejection = (e: PromiseRejectionEvent) => thrown.push(String(e.reason))
    addEventListener('error', onError)
    addEventListener('unhandledrejection', onRejection)
    const after: Record<string, number> = {}
    try {
      for (const leaf of leaves) {
        await userEvent.click(button(leaf, FORWARD))
        expect(at(leaf).step, `precondition: ▶ stepped ${leaf}`).toBe(1)
        await userEvent.click(button(leaf, RESTART))
        after[leaf] = at(leaf).step
      }
    } finally {
      removeEventListener('error', onError)
      removeEventListener('unhandledrejection', onRejection)
    }
    expect(thrown, 'what the presses threw').toEqual([])
    expect(after, 'each view after its ↺').toEqual({ 'tm-0': 0, 'rxm-0': 0, 'clif-0': 0 })
    await userEvent.click(toggle)
  }, 90_000)

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
})

describe('the hold on the session workers, once the cases above are done', () => {
  it('has given the page its own `Worker` back, its prototype untouched', () => {
    expect(globalThis.Worker, 'the constructor').toBe(PageWorker)
    expect(Worker.prototype.addEventListener, 'what adds a listener').toBe(EventTarget.prototype.addEventListener)
  })
})
