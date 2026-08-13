import { beforeEach, describe, expect, it } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import { layoutControls } from '../../src/pane-chrome'
import { TmPane } from '../../src/tm-pane'

/**
 * THE LAYOUT CONTROLS, AND THE ABSENCES THAT ARE THE DESIGN.
 *
 * Both "cannot" cases are asserted as REMOVAL rather than as `disabled`, per the accessibility list's
 * item 1 — a control that provably cannot work should not be offered. The source pane has no split
 * because there is one editor to duplicate; the last leaf has no close because an empty tree has no
 * rendering.
 */

const noop = () => {}
const events = (over: Partial<PaneEvents> = {}): PaneEvents => ({
  back: noop,
  forward: noop,
  play: noop,
  restart: noop,
  extend: noop,
  rebind: noop,
  ...over,
})

let parent: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  parent = document.createElement('div')
  document.body.append(parent)
})

const buttons = () => [...parent.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))

describe('layoutControls', () => {
  it('offers split and close when both are possible', () => {
    layoutControls(parent, events()).update(true, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom', 'close this pane'])
  })

  it('REMOVES the split controls rather than disabling them when splitting is impossible', () => {
    layoutControls(parent, events()).update(true, false)
    expect(buttons()).toEqual(['close this pane'])
    expect(parent.querySelectorAll('button[disabled]').length).toBe(0)
  })

  it('REMOVES the close control rather than disabling it when this is the last leaf', () => {
    layoutControls(parent, events()).update(false, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom'])
    expect(parent.querySelectorAll('button[disabled]').length).toBe(0)
  })

  it('reports each gesture exactly once per click', () => {
    const seen: string[] = []
    const c = layoutControls(
      parent,
      events({
        splitRow: () => seen.push('row'),
        splitColumn: () => seen.push('column'),
        close: () => seen.push('close'),
      }),
    )
    c.update(true, true)
    for (const b of parent.querySelectorAll('button')) (b as HTMLButtonElement).click()
    expect(seen).toEqual(['row', 'column', 'close'])
  })

  it('does not rewire its handlers when update is called again', () => {
    const seen: string[] = []
    const c = layoutControls(parent, events({ close: () => seen.push('close') }))
    c.update(true, true)
    c.update(true, true)
    c.update(true, true)
    const close = parent.querySelector('button[aria-label="close this pane"]') as HTMLButtonElement
    close.click()
    expect(seen).toEqual(['close'])
  })

  /**
   * FINDING 1. `parent.append(splitRow, splitColumn)` MOVES existing nodes to the end of `parent`
   * rather than duplicating them. Every test above this one makes a SINGLE transition from a fresh
   * instance, so `close` was never mounted when the splits were (re)appended and this bug never had
   * anything to shove out of place. This is the sequence that does: split and close both show, splitting
   * turns off, splitting turns back on — and without the re-append in `layoutControls`, `close` (mounted
   * on the first `update` and never removed) is left sitting in front of the two split buttons instead
   * of after them.
   */
  it('keeps split-row, split-column, close in order across a canSplit toggle', () => {
    const c = layoutControls(parent, events())
    c.update(true, true)
    c.update(true, false)
    c.update(true, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom', 'close this pane'])
  })

  /**
   * FINDING 3. Every `it` above either never shows a control (asserting absence of something that was
   * never added) or shows one and leaves it — `shownSplit`/`shownClose` both default to `false`, so a
   * fresh instance's `.remove()` branch never runs. These two mount first and then drive the SAME
   * transition a fresh instance would make for "impossible", so the `.remove()` calls are the only way
   * the assertion can pass.
   */
  it('removes the split controls, once mounted, when splitting stops being possible', () => {
    const c = layoutControls(parent, events())
    c.update(true, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom', 'close this pane'])
    c.update(true, false)
    expect(buttons()).toEqual(['close this pane'])
  })

  it('removes the close control, once mounted, when this becomes the last leaf', () => {
    const c = layoutControls(parent, events())
    c.update(true, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom', 'close this pane'])
    c.update(false, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom'])
  })
})

/**
 * FINDING 2. `LambdaPane.setLayoutControls` and `TmPane.setLayoutControls` are the only call sites
 * `layoutControls` has outside this file's direct construction above, and neither pane's own test
 * suite reached them. Constructed the way `tests/browser/binding-selector.test.ts` and
 * `tests/browser/detached-badge.test.ts` construct a real pane — a bare host element and a `PaneEvents`
 * with no gesture wired — because the assertion is about the CONTROLS' presence in THAT pane's DOM, not
 * about what a click does; `layoutControls`'s own tests above already cover the click and the ordering.
 */
const paneHost = () => {
  const el = document.createElement('section')
  el.className = 'pane'
  document.body.append(el)
  return el
}

const layoutButtons = (pane: HTMLElement) =>
  [...pane.querySelectorAll('button.layout-control')].map((b) => b.getAttribute('aria-label'))

describe('LambdaPane.setLayoutControls', () => {
  it('adds and removes the split and close controls on a real pane', () => {
    const el = paneHost()
    const pane = new LambdaPane(el, events())
    expect(layoutButtons(el)).toEqual([])

    pane.setLayoutControls(true, true)
    expect(layoutButtons(el)).toEqual(['split left and right', 'split top and bottom', 'close this pane'])

    pane.setLayoutControls(false, false)
    expect(layoutButtons(el)).toEqual([])
  })
})

describe('TmPane.setLayoutControls', () => {
  it('adds and removes the split and close controls on a real pane', () => {
    const el = paneHost()
    const pane = new TmPane(el, events())
    expect(layoutButtons(el)).toEqual([])

    pane.setLayoutControls(true, true)
    expect(layoutButtons(el)).toEqual(['split left and right', 'split top and bottom', 'close this pane'])

    pane.setLayoutControls(false, false)
    expect(layoutButtons(el)).toEqual([])
  })
})
