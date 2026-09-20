import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { PRESETS } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A WORKSPACE STORED BY PART 2a, BOOTED BY PART 2b** — spec §3's `inspector` rule, through the real app.
 *
 * Part 2a shipped version 2 without an `inspector` field, so every workspace written before part 2b has
 * none. §3 holds every other field to `parseLayout`'s standard — an unknown value invalidates the whole
 * envelope and the layout silently resets — and this field is the one exception: MISSING means "the version
 * that wrote this did not have it", which is not the same claim as "this value is wrong".
 *
 * **NOTHING ELSE IN THE TIER BOOTS ON A 2a-SHAPED ENVELOPE, WHICH IS WHY THIS FILE EXISTS.** The pre-flight
 * sabotage that made a missing `inspector` invalidate the envelope reddened the node parser test and left
 * all 422 browser tests green — because every other browser file's stored envelope is written by this
 * build, which always includes the field. The harm §3 is protecting against is an upgrading user's layout
 * resetting, and only a boot can show it.
 */

/** Exactly what `serializeWorkspace` emitted at part 2a: version 2, and no `inspector`. */
const AS_2A = JSON.stringify({
  version: 2,
  tree: {
    kind: 'split',
    dir: 'row',
    sizes: [0.5, 0.5],
    children: [
      { kind: 'leaf', id: 'source', pane: 'source' },
      { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
    ],
  },
  switches: PRESETS.explorer,
  speed: 250,
  focused: 'lambda-0',
  panels: {},
})

beforeAll(async () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, AS_2A)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('a workspace stored by part 2a', () => {
  // THE WHOLE POINT: the stored tree is TWO leaves, not the default three. If the envelope had been
  // refused, the app would have fallen back to `defaultLayout()` and this would read three.
  it('keeps the tree it was stored with, rather than resetting to the default', () => {
    expect([...document.querySelectorAll('#views [data-leaf]')].map((el) => (el as HTMLElement).dataset.leaf)).toEqual([
      'source',
      'lambda-0',
    ])
    expect(document.querySelector<HTMLSelectElement>('[data-leaf="lambda-0"] select.speed')?.value).toBe('250')
  })

  /**
   * **THIS CASE CANNOT STAND ALONE, AND THE ASSERTION THAT MAKES IT MEAN ANYTHING IS THE TREE.**
   * `defaultWorkspace()` also has `inspector: true`, so a total envelope REFUSAL produces exactly the same
   * reading here — which is what the case above rules out by asserting the stored two-leaf tree survived.
   * They are one claim in two halves, so the tree is re-asserted here rather than left implicit.
   */
  it('opens the inspector, which the stored envelope could not say anything about', () => {
    expect(
      [...document.querySelectorAll('#views [data-leaf]')].map((el) => (el as HTMLElement).dataset.leaf),
      'the envelope was refused, so the inspector reading below is the default and proves nothing',
    ).toEqual(['source', 'lambda-0'])
    expect(document.querySelector('#inspector .panel-toggle')?.getAttribute('aria-expanded')).toBe('true')
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}').inspector).toBe(true)
  })
})
