import { afterEach, describe, expect, it } from 'vitest'
import type { ControlState } from '../../src/controls'
import { stepControls } from '../../src/step-controls'
import type { Speed } from '../../src/workspace'

const STATE: ControlState = {
  canBack: true,
  canForward: true,
  canPlay: true,
  canRestart: true,
  playing: false,
  continueLabel: null,
  stepText: 'step 3 of 12',
}

afterEach(() => {
  document.body.replaceChildren()
})

const build = () => {
  const log: string[] = []
  let speed: Speed = 8
  const s = stepControls({
    back: () => log.push('back'),
    forward: () => log.push('forward'),
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
    for (const name of ['back to the oldest kept step', 'one step back', 'one step forward', 'play', 'playback speed'])
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
   * unavailable branch disables all four transport buttons and offers no continue label at once, so the
   * neighbour chain has nothing in it; the speed select is what is left, and it is never disabled.
   */
  it('still hands the focus on when nothing in the strip is live', () => {
    const { s } = build()
    s.update({ ...STATE, continueLabel: 'keep recording' })
    s.el.querySelector<HTMLButtonElement>('button.extend')?.focus()
    s.update({
      canBack: false,
      canForward: false,
      canPlay: false,
      canRestart: false,
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
