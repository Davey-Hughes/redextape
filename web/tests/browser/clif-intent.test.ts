import { afterEach, describe, expect, it, vi } from 'vitest'
import { commands, userEvent } from 'vitest/browser'
import { INTENT_MS, watchIntent } from '../../src/clif-intent'
import { sleep } from './clif-fixture'
import { pageCentreOf } from './harness'

/**
 * **INTENT IS WHAT THE USER DID** (CLIF view design §6, *Loading*): a pointer that moved onto the element and stayed
 * `INTENT_MS`, a press, or a focus. An element drawn under a pointer that has not moved gets the browser's
 * `pointerenter` and no `pointermove`, and fetches nothing, as a clif toggle a page draws under the resting pointer must
 * not fetch `pkg-clif`. Real pointer moves, through Playwright's mouse.
 */

/**
 * A `tag` watched for intent, placed at the page's top left, and how many times it asked to fetch. **A `div` TAKES NO
 * FOCUS FROM A PRESS**, so its press is heard alone.
 */
function watched(tag: 'button' | 'div' = 'button'): {
  readonly el: HTMLElement
  readonly fetched: () => number
  readonly entered: () => number
} {
  const el = document.createElement(tag)
  el.textContent = 'clif'
  el.style.cssText = 'position: fixed; left: 20px; top: 20px; width: 120px; height: 40px'
  let fetched = 0
  let entered = 0
  watchIntent(el, () => {
    fetched += 1
  })
  el.addEventListener('pointerenter', () => {
    entered += 1
  })
  return { el, fetched: () => fetched, entered: () => entered }
}

/** A point well away from where `watched` puts its button. */
const AWAY = { x: 600, y: 400 }

afterEach(async () => {
  document.body.replaceChildren()
  await commands.mouse('move', AWAY.x, AWAY.y)
})

describe('watchIntent', () => {
  /** As a header is rebuilt under the pointer: the element under the pointer goes, and the new one takes its place. */
  it('fetches nothing for an element drawn under a pointer that has not moved', async () => {
    const w = watched()
    const before = document.createElement('div')
    before.style.cssText = 'position: fixed; left: 20px; top: 20px; width: 120px; height: 40px'
    document.body.append(before)
    const at = pageCentreOf(before)
    await commands.mouse('move', at.x, at.y)
    before.replaceWith(w.el)
    await sleep(INTENT_MS + 150)
    expect(w.entered(), 'precondition: the browser entered the element under the still pointer').toBeGreaterThan(0)
    expect(w.fetched()).toBe(0)
  })

  /**
   * **THE REST'S TIMER IS FAKED**, so a pass is a pass however long the two moves' round trips take on a loaded
   * machine: the rest's time passes only when the case says, after the pointer has left.
   */
  it('fetches once a pointer that moved onto it has stayed, and not for one passing over', async () => {
    const w = watched()
    document.body.append(w.el)
    const at = pageCentreOf(w.el)
    const heard: string[] = []
    for (const type of ['pointermove', 'pointerleave']) w.el.addEventListener(type, () => heard.push(type))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await commands.mouse('move', at.x, at.y)
      await commands.mouse('move', AWAY.x, AWAY.y)
      vi.advanceTimersByTime(2 * INTENT_MS)
      expect(heard.slice(0, 1), 'precondition: the pointer moved on it').toEqual(['pointermove'])
      expect(heard.at(-1), 'precondition: and left it').toBe('pointerleave')
      expect(w.fetched(), 'a pass').toBe(0)
      await commands.mouse('move', at.x, at.y)
      vi.advanceTimersByTime(INTENT_MS)
      expect(w.fetched(), 'a rest').toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * **COUNTED AROUND THE PRESS'S OWN `pointerdown`**: before it reaches the element, on the way down, and after
   * `watchIntent`'s listener, so a rest the move to it began cannot be counted as the press, however long the press takes.
   */
  it('fetches at once on a press', async () => {
    const w = watched('div')
    document.body.append(w.el)
    const at = pageCentreOf(w.el)
    let [before, after] = [-1, -1]
    const down = () => {
      before = w.fetched()
    }
    document.addEventListener('pointerdown', down, { capture: true })
    w.el.addEventListener('pointerdown', () => {
      after = w.fetched()
    })
    try {
      await commands.mouse('down', at.x, at.y)
      await commands.mouse('up', at.x, at.y)
    } finally {
      document.removeEventListener('pointerdown', down, { capture: true })
    }
    expect(before, 'precondition: the press reached the element').toBeGreaterThanOrEqual(0)
    expect(document.activeElement, 'precondition: the press focused nothing').toBe(document.body)
    expect(after - before, 'the press').toBe(1)
  })

  it('fetches at once on a focus', async () => {
    const w = watched()
    document.body.append(w.el)
    await userEvent.tab()
    expect(document.activeElement, 'precondition: Tab focused it').toBe(w.el)
    expect(w.fetched()).toBe(1)
  })
})
