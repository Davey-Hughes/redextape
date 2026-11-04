import { afterEach, describe, expect, it } from 'vitest'
import { cdp, userEvent } from 'vitest/browser'
import { canRecordFurther, controlState as legControls } from '../../src/controls'
import { keepFocusOn } from '../../src/focus-handoff'
import { History } from '../../src/history'
import type { RecordEnd } from '../../src/protocol'
import { createStepBar } from '../../src/step-bar'
import { stepControls } from '../../src/step-controls'
import type { Speed } from '../../src/workspace'
import { chromiumOnly } from './engine'
import { controlName, controlState, legView, pressable, settledFocus, tick } from './harness'

const STATE = controlState(true, 'step 3 of 12')

afterEach(() => {
  document.body.replaceChildren()
})

const build = () => {
  const log: string[] = []
  let speed: Speed = 8
  const s = stepControls({
    back: () => log.push('back'),
    forward: () => log.push('forward'),
    toNewest: () => log.push('toNewest'),
    play: () => log.push('play'),
    restart: () => log.push('restart'),
    extend: () => log.push('extend'),
    speed: () => speed,
    setSpeed: (v) => {
      speed = v
      log.push(`speed ${v}`)
    },
  })
  document.body.append(s.el)
  return { s, log }
}

const byName = (el: HTMLElement, name: string) => el.querySelector<HTMLElement>(`[aria-label="${name}"]`)

describe('the step controls', () => {
  it('names every button in words, and shows the step', () => {
    const { s } = build()
    s.update(STATE)
    for (const name of [
      'back to the oldest kept step',
      'one step back',
      'one step forward',
      'to the newest recorded step',
      'play',
      'playback speed',
    ])
      expect(byName(s.el, name)).not.toBeNull()
    expect(s.el.querySelector('.step')?.textContent).toBe('step 3 of 12')
  })

  it('shows ⏸ and is named pause while playing, and ⏵ and play when not', () => {
    const { s } = build()
    s.update({ ...STATE, playing: true })
    const play = s.el.querySelector<HTMLButtonElement>('button.play')
    expect(play?.getAttribute('aria-label')).toBe('pause')
    expect(play?.title).toBe('pause')
    expect(play?.querySelector('svg')?.dataset.icon).toBe('pause')
    s.update({ ...STATE, playing: false })
    expect(play?.getAttribute('aria-label')).toBe('play')
    expect(play?.querySelector('svg')?.dataset.icon).toBe('play')
  })

  it('offers the speed ladder, shows the one in force, and reports a change', () => {
    const { s, log } = build()
    s.update(STATE)
    const select = s.el.querySelector<HTMLSelectElement>('select.speed')
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual([
      '1/s',
      '2/s',
      '4/s',
      '8/s',
      '15/s',
      '30/s',
      '60/s',
      '250/s',
      '1,000/s',
      '5,000/s',
    ])
    expect(select?.value).toBe('8')
    if (select === null) throw new Error('no speed select')
    select.value = '5000'
    select.dispatchEvent(new Event('change'))
    expect(log).toEqual(['speed 5000'])
  })

  it('shows the continue button only while there is more to record, never disabled', () => {
    const { s } = build()
    s.update(STATE)
    expect(s.el.querySelector<HTMLButtonElement>('button.extend')?.hidden).toBe(true)
    s.update({ ...STATE, continueLabel: 'keep recording' })
    expect(s.el.querySelector<HTMLButtonElement>('button.extend')?.hidden).toBe(false)
    expect(s.el.querySelector('button.extend')?.textContent).toBe('keep recording')
  })

  /**
   * **THE CHAIN'S END, WHICH IS THE STATE A COPY'S WORKER THROWING PRODUCES.** `controls.ts`'s
   * unavailable branch disables every transport button and offers no continue label at once, so the
   * neighbour chain has nothing in it; the speed select is what is left, and it is never disabled.
   */
  it('still hands the focus on when nothing in the strip is live', () => {
    const { s } = build()
    s.update({ ...STATE, continueLabel: 'keep recording' })
    s.el.querySelector<HTMLButtonElement>('button.extend')?.focus()
    s.update({
      canBack: false,
      canForward: false,
      canToNewest: false,
      canPlay: false,
      canRestart: false,
      recording: false,
      playing: false,
      continueLabel: null,
      stepText: 'the copy failed',
    })
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(s.el.querySelector('select.speed'))
  })

  it('moves focus to a neighbour when the continue button it sits on goes away', () => {
    const { s } = build()
    s.update({ ...STATE, continueLabel: 'keep recording' })
    s.el.querySelector<HTMLButtonElement>('button.extend')?.focus()
    s.update({ ...STATE, continueLabel: null })
    expect(document.activeElement).toBe(s.el.querySelector('[aria-label="one step forward"]'))
  })
})

/**
 * A strip whose handlers move a `History` as `transport.ts`'s do and repaint at once, with `controls.ts`'s own rules
 * deciding what is live. A frame costs one byte and the budget holds `length` frames, so the history starts full and
 * each frame `record` pushes evicts the oldest, as `replies.ts` pushes a batch and sets `done`. `done` is how the
 * recording stopped, `null` while it records; `ended` offers no more. `tick` is one step of `player.ts`'s loop. `log`
 * names each handler a press reached; `asked` counts the presses that would ask the worker for more.
 */
const driven = (head: number, length: number, done: RecordEnd | null = 'ended') => {
  const hist = new History<number>(length - 1)
  for (let i = 0; i < length; i += 1) hist.push(i, 1)
  hist.seek(head)
  const leg = { hist, done, playing: false, asked: 0, log: [] as string[] }
  const draw = () =>
    s.update(
      legControls(
        legView({
          head: hist.head,
          length: hist.length,
          oldestStep: hist.oldestStep,
          currentStep: hist.currentStep,
          newestStep: hist.newestStep,
          evicted: hist.evicted,
          done: leg.done,
          playing: leg.playing,
        }),
      ),
    )
  const s = stepControls({
    back: () => {
      leg.log.push('back')
      hist.back()
      draw()
    },
    forward: () => {
      leg.log.push('forward')
      if (!hist.forward() && canRecordFurther(leg.done, false)) leg.asked += 1
      draw()
    },
    toNewest: () => {
      leg.log.push('toNewest')
      hist.seek(hist.length - 1)
      draw()
    },
    restart: () => {
      leg.log.push('restart')
      hist.seek(0)
      draw()
    },
    play: () => {
      leg.log.push('play')
      leg.playing = !leg.playing
      draw()
    },
    extend: () => {
      leg.log.push('extend')
      leg.asked += 1
    },
    speed: () => 8,
    setSpeed: () => {},
  })
  document.body.append(s.el)
  draw()
  const tick = () => {
    if (!hist.forward()) leg.playing = false
    draw()
  }
  const record = (frames: number, now: RecordEnd | null) => {
    for (let i = 0; i < frames; i += 1) hist.push(hist.newestStep + 1, 1)
    leg.done = now
    draw()
  }
  return { s, leg, draw, tick, record }
}

const mustName = (el: HTMLElement, name: string): HTMLButtonElement => {
  const b = el.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
  if (b === null) throw new Error(`no button named ${name}`)
  return b
}

/**
 * What held the focus each time `b` went from enabled to disabled, by name, read inside the `disabled` setter, before the
 * button changes. **THIS IS THE CALL ORDER, WHATEVER THE BROWSER'S BLUR TIMING**: a hand-off made after the disable
 * still lands on the neighbour wherever the blur is deferred, so only this read can tell the two orders apart. A
 * disable made some other way (`setAttribute`) records nothing and fails the comparison rather than passing it.
 */
const focusAtDisable = (b: HTMLButtonElement): string[] => {
  const seen: string[] = []
  const { get, set } = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'disabled') ?? {}
  if (get === undefined || set === undefined) throw new Error('no `disabled` accessor on HTMLButtonElement')
  Object.defineProperty(b, 'disabled', {
    configurable: true,
    get: () => get.call(b),
    set: (v: boolean) => {
      if (v && !get.call(b)) seen.push(controlName(document.activeElement))
      set.call(b, v)
    },
  })
  return seen
}

const BACK = 'one step back'
const FORWARD = 'one step forward'
const NEWEST = 'to the newest recorded step'

/**
 * Each press that turns its own button off on a run stopped `done`, and where the focus belongs then (`step-controls.ts`'s
 * `buttons`). `⏭` hands to `▶` where the run can record further, so that the next Enter does.
 */
const PRESSES = [
  { what: '◀ at step 1', press: BACK, head: 1, length: 12, done: 'ended', to: FORWARD },
  // ▶ AND ⏭ ARE OFF AT A TWO-STEP RUN'S LAST STEP, AND THIS PRESS TURNS THEM ON: the hand-off must read the new state.
  { what: '◀ at step 1 of two', press: BACK, head: 1, length: 2, done: 'ended', to: FORWARD },
  { what: '▶ at the last step but one', press: FORWARD, head: 10, length: 12, done: 'ended', to: BACK },
  { what: '⏭', press: NEWEST, head: 3, length: 12, done: 'ended', to: BACK },
  { what: '⏭ at a `budget` stop', press: NEWEST, head: 3, length: 12, done: 'budget', to: FORWARD },
  { what: '⏭ at a `capped` stop', press: NEWEST, head: 3, length: 12, done: 'capped', to: FORWARD },
] as const

const GESTURES = {
  click: async (b: HTMLButtonElement) => {
    expect(document.activeElement, 'precondition: the focus starts on <body>').toBe(document.body)
    let focused = false
    b.addEventListener('focus', () => (focused = true), { once: true })
    await userEvent.click(b)
    expect(focused, 'precondition: the click focused the button').toBe(true)
  },
  Enter: async (b: HTMLButtonElement) => {
    b.focus()
    expect(document.activeElement, 'precondition: the button holds the focus').toBe(b)
    await userEvent.keyboard('{Enter}')
  },
}

describe('a step button that turns itself off hands the focus on', () => {
  for (const { what, press, head, length, done, to } of PRESSES) {
    for (const [gesture, perform] of Object.entries(GESTURES)) {
      it(`${what}, by ${gesture}`, async () => {
        const { s } = driven(head, length, done)
        const button = mustName(s.el, press)
        await perform(button)
        expect(button.disabled, 'precondition: the press turned the button off').toBe(true)
        expect(await settledFocus()).toBe(to)
      })
    }

    it(`${what}, before the button is disabled`, async () => {
      const { s } = driven(head, length, done)
      const button = mustName(s.el, press)
      const seen = focusAtDisable(button)
      button.focus()
      expect(document.activeElement, 'precondition: the button holds the focus').toBe(button)
      button.click()
      expect(seen, 'the focus when the button was disabled').toEqual([to])
    })
  }
})

/**
 * **A STATE CHANGE, NOT THE BUTTON'S OWN PRESS, TURNS IT OFF UNDER THE FOCUS**: playback reaching the end (`▶`, `⏭`), a
 * recording's evictions carrying the head to the oldest kept step (`◀`), a new run (`⏵`), an unavailable leg (`↺`). A
 * real gesture puts the focus there; the change is the test's, as it is a timer's or a worker's in the app. `↺` and `⏵`
 * never turn themselves off: their presses leave the history's length alone, which is all their `can*` reads.
 */
describe('a step button a state change turns off hands the focus on', () => {
  for (const [what, name, shiftTabs] of [
    ['▶', FORWARD, 2],
    ['⏭', NEWEST, 1],
  ] as const) {
    it(`${what}, when playback reaches the end`, async () => {
      const { s, tick } = driven(9, 12)
      const button = mustName(s.el, name)
      const seen = focusAtDisable(button)
      await userEvent.click(mustName(s.el, 'play'))
      for (let i = 0; i < shiftTabs; i += 1) await userEvent.tab({ shift: true })
      expect(document.activeElement, `precondition: Shift+Tab from ⏵ reaches ${what}`).toBe(button)
      tick()
      expect(button.disabled, `precondition: ${what} is live a step before the end`).toBe(false)
      tick()
      expect(button.disabled, `precondition: playback reaching the end turned ${what} off`).toBe(true)
      expect.soft(seen, `the focus when ${what} was disabled`).toEqual([BACK])
      expect.soft(await settledFocus(), 'where the focus settles').toBe(BACK)
    })
  }

  it('◀, when a recording evicts the frames before the head', async () => {
    const { s, leg, record } = driven(2, 12, null)
    const back = mustName(s.el, BACK)
    const seen = focusAtDisable(back)
    await userEvent.click(back)
    expect(back.disabled, 'precondition: ◀ is live a step after the oldest').toBe(false)
    record(3, null)
    expect(leg.hist.oldestStep, 'precondition: the history evicted three frames').toBe(3)
    expect(back.disabled, 'precondition: the evictions turned ◀ off').toBe(true)
    expect.soft(seen, 'the focus when ◀ was disabled').toEqual([FORWARD])
    expect.soft(await settledFocus(), 'where the focus settles').toBe(FORWARD)
  })

  it('⏵, when a new run holds one step and only ↺ is left', async () => {
    const { s, leg, draw } = driven(0, 12)
    const play = s.el.querySelector<HTMLButtonElement>('button.play')
    if (play === null) throw new Error('no play button')
    const seen = focusAtDisable(play)
    play.focus()
    expect(document.activeElement, 'precondition: ⏵ holds the focus').toBe(play)
    leg.hist.clear()
    leg.hist.push(0, 1)
    draw()
    const restart = mustName(s.el, 'back to the oldest kept step')
    expect.soft(seen, 'the focus when ⏵ was disabled').toEqual([controlName(restart)])
    expect.soft(await settledFocus(), 'where the focus settles').toBe(controlName(restart))
  })

  it('↺, when the leg becomes unavailable and only the speed select is left', async () => {
    const { s } = driven(3, 12)
    const restart = mustName(s.el, 'back to the oldest kept step')
    const seen = focusAtDisable(restart)
    restart.focus()
    expect(document.activeElement, 'precondition: ↺ holds the focus').toBe(restart)
    s.update({
      canBack: false,
      canForward: false,
      canToNewest: false,
      canPlay: false,
      canRestart: false,
      recording: false,
      playing: false,
      continueLabel: null,
      stepText: 'the copy failed',
    })
    expect.soft(seen, 'the focus when ↺ was disabled').toEqual(['playback speed'])
    expect.soft(await settledFocus(), 'where the focus settles').toBe('playback speed')
  })
})

/** Whether `b` is waiting on a recording: off by `aria-disabled` alone, so that it keeps the focus. */
const waiting = (b: HTMLButtonElement): boolean => b.getAttribute('aria-disabled') === 'true' && !b.disabled

/** A button off in the ordinary way: disabled, and not saying it waits. */
const off = (b: HTMLButtonElement): boolean => b.disabled && b.getAttribute('aria-disabled') === null

/** The alpha of a computed colour, in either of the forms Chromium writes one. */
const alphaOf = (colour: string): number => {
  const m = /(?:\/\s*|rgba\((?:[^,]+,){3}\s*)([\d.]+)\)$/.exec(colour)
  return m === null ? 1 : Number(m[1])
}

/**
 * **A `▶` OR `⏭` THAT A RECORDING CARRYING THE HEAD TURNS OFF UNDER THE FOCUS WAITS FOR IT** (`step-controls.ts`'s
 * `update`): focused, off by `aria-disabled`, a press on it doing nothing; live again where the recording stops with it
 * live, and disabled with its hand-off only once the run can record no further.
 */
describe('a ▶ or ⏭ a recording turns off under the focus waits for it', () => {
  for (const [gesture, perform] of Object.entries(GESTURES)) {
    it(`▶ pressed by ${gesture} at a \`budget\` frontier keeps the focus, and records further at the stop`, async () => {
      const { s, leg, record } = driven(11, 12, 'budget')
      const forward = mustName(s.el, FORWARD)
      await perform(forward)
      expect(leg.asked, 'precondition: the press asked for more').toBe(1)
      record(3, null)
      expect(await settledFocus(), 'where the focus settles while it records').toBe(FORWARD)
      expect(waiting(forward), '▶ waits while the recording carries the head').toBe(true)
      await userEvent.keyboard('{Enter}')
      await userEvent.keyboard('[Space]')
      expect(leg.log, 'what Enter and Space on the waiting ▶ reached').toEqual(['forward'])
      record(3, 'budget')
      expect(forward.disabled || forward.getAttribute('aria-disabled') !== null, '▶ is live at the stop').toBe(false)
      expect(await settledFocus(), 'where the focus settles at the stop').toBe(FORWARD)
      await userEvent.keyboard('{Enter}')
      expect(leg.asked, 'the Enter at the stop asks for more').toBe(2)
    })
  }

  it('▶ waiting when the recording runs the program to its end is disabled and hands the focus to ◀', async () => {
    const { s, record } = driven(11, 12, 'budget')
    const forward = mustName(s.el, FORWARD)
    const seen = focusAtDisable(forward)
    await GESTURES.Enter(forward)
    record(3, null)
    expect(waiting(forward), 'precondition: ▶ waits while the recording carries the head').toBe(true)
    record(2, 'ended')
    expect(off(forward), '▶ is off once the run has ended').toBe(true)
    expect.soft(seen, 'the focus when ▶ was disabled').toEqual([BACK])
    expect.soft(await settledFocus(), 'where the focus settles').toBe(BACK)
  })

  for (const [gesture, perform] of Object.entries(GESTURES)) {
    it(`⏭ pressed by ${gesture} while it records waits, and hands the focus to ▶ at a \`budget\` stop`, async () => {
      const { s, leg, record } = driven(3, 12, null)
      const newest = mustName(s.el, NEWEST)
      const seen = focusAtDisable(newest)
      await perform(newest)
      expect(await settledFocus(), 'where the focus settles while it records').toBe(NEWEST)
      expect(waiting(newest), '⏭ waits while the recording carries the head').toBe(true)
      expect(off(mustName(s.el, FORWARD)), 'the ▶ the focus is not on is disabled').toBe(true)
      record(3, null)
      record(2, 'budget')
      expect(await settledFocus(), 'where the focus settles at the stop').toBe(FORWARD)
      expect(off(newest), '⏭ at the stop').toBe(true)
      expect(seen, 'the focus when ⏭ was disabled').toEqual([FORWARD])
      await userEvent.keyboard('{Enter}')
      expect(leg.log, 'what the Enter at the stop reached').toEqual(['toNewest', 'forward'])
      expect(leg.asked, 'the Enter at the stop asks for more').toBe(1)
    })
  }

  it('⏭ at a `budget` stop hands the focus to ▶, where the next Enter records further, as after a recording', async () => {
    const { s, leg } = driven(3, 12, 'budget')
    await GESTURES.Enter(mustName(s.el, NEWEST))
    expect(await settledFocus(), 'where the focus settles').toBe(FORWARD)
    await userEvent.keyboard('{Enter}')
    expect(leg.log, 'what the Enter after the hand-off reached').toEqual(['toNewest', 'forward'])
    expect(leg.asked, 'the Enter after the hand-off asks for more').toBe(1)
  })

  it('⏭ waiting is disabled and hands the focus to ◀ once the run ends', async () => {
    const { s, record } = driven(3, 12, null)
    const newest = mustName(s.el, NEWEST)
    const seen = focusAtDisable(newest)
    await GESTURES.Enter(newest)
    expect(waiting(newest), 'precondition: ⏭ waits while the recording carries the head').toBe(true)
    record(2, 'ended')
    expect(off(newest), '⏭ is off once the run has ended').toBe(true)
    expect.soft(seen, 'the focus when ⏭ was disabled').toEqual([BACK])
    expect.soft(await settledFocus(), 'where the focus settles').toBe(BACK)
  })

  it('a waiting ⏭ the focus leaves is disabled at once, so Tab passes it', async () => {
    const { s, record } = driven(3, 12, null)
    const newest = mustName(s.el, NEWEST)
    await GESTURES.Enter(newest)
    record(2, null)
    expect(waiting(newest), 'precondition: ⏭ waits while it records').toBe(true)
    await userEvent.tab({ shift: true })
    expect(await settledFocus(), 'precondition: Shift+Tab from ⏭ passes the disabled ▶ to ◀').toBe(BACK)
    expect(off(newest), '⏭ once the focus has left it').toBe(true)
    await userEvent.tab()
    expect(await settledFocus(), 'where Tab from ◀ goes').toBe('play')
  })

  it('a waiting ⏭ taken off the page with the focus is disabled, so it is no Tab stop when it is back', async (ctx) => {
    chromiumOnly(
      ctx,
      'Firefox sends a focused button taken off the page no `blur`; the no-`blur` case below runs in both',
    )
    const { s, record } = driven(3, 12, null)
    const newest = mustName(s.el, NEWEST)
    await GESTURES.Enter(newest)
    record(2, null)
    expect(waiting(newest), 'precondition: ⏭ waits while it records').toBe(true)
    s.el.remove()
    document.body.append(s.el)
    expect(off(newest), '⏭ once it is back on the page').toBe(true)
    mustName(s.el, BACK).focus()
    await userEvent.tab()
    expect(await settledFocus(), 'where Tab from ◀ goes').toBe('play')
  })

  // **A REBUILD THAT GIVES THE FOCUS BACK** (`focus-handoff.ts`'s `keepFocusOn`, as `pane-host.ts`'s `keepingFocus` runs
  // one) takes the strip off the page, puts it back, runs `draw`, and then focuses the button it took the focus from.
  const rebuilt = (b: HTMLButtonElement, el: HTMLElement, draw: () => void): void => {
    keepFocusOn(b, () => {
      el.remove()
      document.body.append(el)
      draw()
    })
    b.focus()
  }

  // A REBUILD THAT DOES NOT DRAW THE STRIP HOLDS THE `blur` IT SENDS TO `focusHolder`: in one that draws it, the update
  // puts the wait back whatever the `blur` did.
  for (const [how, draws] of [
    ['that draws the strip', true],
    ['that does not draw the strip', false],
  ] as const) {
    it(`a waiting ⏭ a rebuild ${how} gives the focus back to waits on, and hands the focus to ▶ at a \`budget\` stop`, async () => {
      const { s, leg, record } = driven(3, 12, null)
      const newest = mustName(s.el, NEWEST)
      await GESTURES.Enter(newest)
      record(2, null)
      expect(waiting(newest), 'precondition: ⏭ waits while it records').toBe(true)
      rebuilt(newest, s.el, () => {
        if (draws) record(1, null)
      })
      expect(await settledFocus(), 'where the focus settles after the rebuild').toBe(NEWEST)
      expect(waiting(newest), '⏭ after the rebuild').toBe(true)
      record(2, 'budget')
      expect(await settledFocus(), 'where the focus settles at the stop').toBe(FORWARD)
      await userEvent.keyboard('{Enter}')
      expect(leg.asked, 'the Enter at the stop asks for more').toBe(1)
    })
  }

  it('a waiting ⏭ whose run ends in a rebuild that gives the focus back hands the focus to ◀', async () => {
    const { s, record } = driven(3, 12, null)
    const newest = mustName(s.el, NEWEST)
    await GESTURES.Enter(newest)
    record(2, null)
    expect(waiting(newest), 'precondition: ⏭ waits while it records').toBe(true)
    rebuilt(newest, s.el, () => record(2, 'ended'))
    expect(off(newest), '⏭ once the run has ended').toBe(true)
    expect(await settledFocus(), 'where the focus settles').toBe(BACK)
  })

  // **FIREFOX SENDS A FOCUSED BUTTON TAKEN OFF THE PAGE NO `blur`.** A listener capturing it on the strip keeps the one
  // Chromium sends from reaching `⏭`, so that what ends the wait is the strip's own watch on the page.
  it('a waiting ⏭ taken off the page with no `blur` stops waiting there, and is no Tab stop when it is back', async () => {
    const { s, record } = driven(3, 12, null)
    const newest = mustName(s.el, NEWEST)
    await GESTURES.Enter(newest)
    record(2, null)
    expect(waiting(newest), 'precondition: ⏭ waits while it records').toBe(true)
    const swallow = (e: Event): void => {
      if (e.target === newest) e.stopImmediatePropagation()
    }
    s.el.addEventListener('blur', swallow, true)
    try {
      s.el.remove()
      expect(waiting(newest), 'precondition: no `blur` reached ⏭').toBe(true)
      await tick()
      expect(off(newest), '⏭ off the page, once the task that took it off is done').toBe(true)
    } finally {
      s.el.removeEventListener('blur', swallow, true)
    }
    document.body.append(s.el)
    mustName(s.el, BACK).focus()
    await userEvent.tab()
    expect(await settledFocus(), 'where Tab from ◀ goes').toBe('play')
  })

  for (const [gesture, perform] of Object.entries(GESTURES)) {
    it(`[keep recording] pressed by ${gesture} hands the focus to ▶, which waits, so Enter at the next stop records further`, async () => {
      const { s, leg, record } = driven(11, 12, 'budget')
      const extend = s.el.querySelector<HTMLButtonElement>('button.extend')
      if (extend === null) throw new Error('no continue button')
      expect(extend.textContent, 'precondition: the continue button at a `budget` stop').toBe('keep recording')
      const forward = mustName(s.el, FORWARD)
      await perform(extend)
      expect(leg.log, 'precondition: the press asked for more').toEqual(['extend'])
      record(3, null)
      expect(await settledFocus(), 'where the focus settles while it records').toBe(FORWARD)
      expect(waiting(forward), '▶ waits while the recording carries the head').toBe(true)
      record(3, 'budget')
      expect(await settledFocus(), 'where the focus settles at the stop').toBe(FORWARD)
      await userEvent.keyboard('{Enter}')
      expect(leg.log, 'what the Enter at the stop reached').toEqual(['extend', 'forward'])
      expect(leg.asked, 'the Enter at the stop asks for more').toBe(2)
    })
  }

  // **ONLY A BUTTON THE FOCUS REACHED WAITS.** `[continue]`'s hand-off to `▶` misses where the strip is under a hidden
  // ancestor when its recording starts, before the browser moves the focus off it; a `▶` waiting without the focus would
  // be a Tab stop whose press is dropped once the strip is shown again.
  for (const [how, hide] of [
    ['`hidden`', (el: HTMLElement, on: boolean) => el.toggleAttribute('hidden', on)],
    ['`display: none`', (el: HTMLElement, on: boolean) => (el.style.display = on ? 'none' : '')],
  ] as const) {
    it(`[keep recording] whose recording starts under a ${how} ancestor leaves ▶ disabled, so Tab passes it once shown`, async () => {
      const { s, leg, record } = driven(11, 12, 'budget')
      const host = document.createElement('div')
      document.body.append(host)
      host.append(s.el)
      const extend = s.el.querySelector<HTMLButtonElement>('button.extend')
      if (extend === null) throw new Error('no continue button')
      await GESTURES.Enter(extend)
      expect(leg.log, 'precondition: the press asked for more').toEqual(['extend'])
      hide(host, true)
      record(3, null)
      expect(await settledFocus(), 'precondition: the hidden strip holds no focus').toBe('BODY')
      hide(host, false)
      expect(off(mustName(s.el, FORWARD)), '▶, which the focus did not reach, once the strip is shown').toBe(true)
      mustName(s.el, BACK).focus()
      await userEvent.tab()
      expect(await settledFocus(), 'where Tab from ◀ goes').toBe('play')
    })
  }

  it('▶ waits when playback carries the head onto a recording, whatever pressed it', async () => {
    const { s, tick, record } = driven(9, 12, null)
    const forward = mustName(s.el, FORWARD)
    await userEvent.click(mustName(s.el, 'play'))
    await userEvent.tab({ shift: true })
    await userEvent.tab({ shift: true })
    expect(document.activeElement, 'precondition: Shift+Tab from ⏵ reaches ▶').toBe(forward)
    tick()
    tick()
    expect(await settledFocus(), 'where the focus settles while it records').toBe(FORWARD)
    expect(waiting(forward), '▶ waits once playback reaches the recording').toBe(true)
    record(2, 'budget')
    expect(forward.disabled, '▶ is live at the stop').toBe(false)
    expect(await settledFocus(), 'where the focus settles at the stop').toBe(FORWARD)
  })

  it('looks off as a disabled step button does, and keeps its focus ring whole', async () => {
    const { s, record } = driven(11, 12, 'budget')
    const forward = mustName(s.el, FORWARD)
    await GESTURES.Enter(forward)
    record(3, null)
    expect(waiting(forward), 'precondition: ▶ waits').toBe(true)
    const disabled = Number(getComputedStyle(mustName(s.el, NEWEST)).opacity)
    expect(disabled, 'precondition: a disabled step button is drawn faint').toBeLessThan(1)
    const look = getComputedStyle(forward)
    expect(look.opacity, 'the waiting ▶ is not faded, which would fade its ring too').toBe('1')
    expect(alphaOf(look.color), 'its glyph is as faint as a disabled one').toBeCloseTo(disabled, 2)
    expect(alphaOf(look.borderTopColor), 'its border is as faint as a disabled one').toBeCloseTo(disabled, 2)
    expect(look.outlineStyle, 'its focus ring').toBe('solid')
    expect(alphaOf(look.outlineColor), 'its focus ring is opaque').toBe(1)
    expect(look.cursor).toBe('default')
  })

  // **FORCED COLOURS REPLACE THE FAINT COLOURS ABOVE WITH THE LIVE BUTTON'S**, so the waiting button needs a system
  // colour of its own: the one the browser draws a disabled button in.
  it('looks off in forced colours as a disabled step button does, and keeps its focus ring', async (ctx) => {
    chromiumOnly(ctx, 'forced colours are CDP’s Emulation.setEmulatedMedia, which only Chromium has')
    const { s, record } = driven(11, 12, 'budget')
    const forward = mustName(s.el, FORWARD)
    await GESTURES.Enter(forward)
    record(3, null)
    expect(waiting(forward), 'precondition: ▶ waits').toBe(true)
    await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] })
    try {
      expect(matchMedia('(forced-colors: active)').matches, 'precondition: forced colours').toBe(true)
      const disabled = getComputedStyle(mustName(s.el, NEWEST))
      const live = getComputedStyle(mustName(s.el, BACK)).color
      expect(disabled.color, 'precondition: a disabled step button is drawn in a colour a live one is not').not.toBe(
        live,
      )
      const look = getComputedStyle(forward)
      expect(look.color, 'the waiting ▶ glyph').toBe(disabled.color)
      expect(look.borderTopColor, 'its border').toBe(disabled.borderTopColor)
      expect(look.outlineStyle, 'its focus ring').toBe('solid')
    } finally {
      await cdp().send('Emulation.setEmulatedMedia', { features: [] })
    }
  })

  it('is no button a press acts on to the test helpers, which ask `pressable`', async () => {
    const { s, leg, record } = driven(3, 12, null)
    const newest = mustName(s.el, NEWEST)
    await GESTURES.Enter(newest)
    record(2, null)
    expect(waiting(newest), 'precondition: ⏭ waits').toBe(true)
    await userEvent.keyboard('{Enter}')
    expect(leg.log, 'precondition: the Enter on the waiting ⏭ was dropped').toEqual(['toNewest'])
    expect(pressable(newest), 'the waiting ⏭').toBe(false)
    expect(pressable(mustName(s.el, FORWARD)), 'the disabled ▶').toBe(false)
    expect(pressable(mustName(s.el, BACK)), 'the live ◀').toBe(true)
  })
})

/**
 * **THE STEP BAR IS ONE STRIP OVER WHICHEVER LEG IT TARGETS** (`step-bar.ts`), so the strip's wait must come from the
 * state it is handed now: a `⏭` waiting on one leg's recording is not still waiting once the bar shows another.
 */
describe('a waiting ⏭ on the step bar', () => {
  it('hands the focus to ▶ when the bar moves to a leg stopped `budget`, where Enter records further', async () => {
    const view = (head: number, length: number, done: RecordEnd | null) =>
      legView({ head, length, currentStep: head, newestStep: length - 1, done })
    const legs = { 'tm-0': view(3, 12, null), 'lambda-0': view(20, 21, 'budget') }
    let on: keyof typeof legs = 'tm-0'
    const log: string[] = []
    const bar = createStepBar({
      target: () => ({ id: on, title: on, controls: legControls(legs[on]) }),
      events: (id) => ({
        back: () => log.push(`back ${id}`),
        forward: () => log.push(`forward ${id}`),
        toNewest: () => {
          log.push(`toNewest ${id}`)
          legs['tm-0'] = view(11, 12, null)
          bar.update()
        },
        play: () => log.push(`play ${id}`),
        restart: () => log.push(`restart ${id}`),
        extend: () => log.push(`extend ${id}`),
      }),
      speed: () => 8,
      setSpeed: () => {},
    })
    document.body.append(bar.el)
    bar.update()
    const newest = mustName(bar.el, NEWEST)
    await GESTURES.Enter(newest)
    expect(await settledFocus(), 'precondition: ⏭ keeps the focus while tm-0 records').toBe(NEWEST)
    expect(waiting(newest), 'precondition: ⏭ waits on tm-0').toBe(true)
    on = 'lambda-0'
    bar.update()
    expect(await settledFocus(), 'where the focus settles on lambda-0').toBe(FORWARD)
    expect(off(newest), '⏭ on lambda-0').toBe(true)
    await userEvent.keyboard('{Enter}')
    expect(log, 'what the two Enters reached').toEqual(['toNewest tm-0', 'forward lambda-0'])
  })
})
