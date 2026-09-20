import { beforeEach, describe, expect, it } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { Leg } from '../../src/protocol'
import type { PaneOption } from '../../src/sessions'
import { TmPane } from '../../src/tm-pane'

/**
 * Design §4.5's SECOND surface: the view is self-describing when the status line is off-screen or the
 * user is looking straight at the view. The FIRST surface — the sentence in `#link-status` — is
 * `tests/node/link-status.test.ts`; §4.5 says the both-surfaces test splits by runner, and this is
 * the half that needs a DOM.
 *
 * **THE STATUS READS `copy · not linked` NOW (Plan 7 part 2 spec §12)**, in the view header's heading
 * beside the title, where the `[detached]` badge used to sit on the pane's `<h2>`. This file is the
 * affordance itself: both views, set and unset, and the non-colour carriers §4.5 requires — none of
 * which is on the path of any app-level gesture. `tests/browser/scratch-app.test.ts` does the app-level
 * version.
 *
 * THE VIEWS ARE CONSTRUCTED DIRECTLY HERE, and `setBindings` is called before anything is asserted
 * because the header paints its title from the pair in force: a view the draw pass has never reached
 * has an empty heading, and every view in the app is reached on its first frame.
 */
const noop = () => undefined

/** `PaneEvents`'s required members, all inert — no test here clicks a control. */
const EVENTS: PaneEvents = {
  back: noop,
  forward: noop,
  play: noop,
  restart: noop,
  extend: noop,
  rebind: noop,
  speed: () => 8,
  setSpeed: noop,
}

const program = (leg: Leg): PaneOption => ({ leg, id: 'source', label: 'program' })

const host = () => {
  const el = document.createElement('section')
  el.className = 'pane'
  document.body.append(el)
  return el
}

/**
 * THE ASSERTION IS ON TEXT, WHICH IS THE WHOLE POINT (§5). Reading the heading's `textContent` — not a
 * class, not a computed colour — is what makes an implementation that satisfies §4.5 with a sixth hue
 * fail: it would leave this string unchanged.
 */
const title = (pane: HTMLElement) => pane.querySelector('h2')?.textContent ?? ''

/** How many status elements the heading holds — 2 would mean a second was appended, not swapped. */
const statusCount = (pane: HTMLElement) => pane.querySelectorAll('h2 .view-status').length

beforeEach(() => {
  document.body.replaceChildren()
})

describe('the copy · not linked status', () => {
  // THE ATTACHED HALF IS THE HALF THAT CATCHES A BROKEN IMPLEMENTATION (§5): a status that is appended
  // and never removed passes the middle assertion and fails the last.
  it('appears on the λ view when detached and is gone when reattached', () => {
    const el = host()
    const pane = new LambdaPane(el, EVENTS)
    pane.setBindings([program('lambda')], { leg: 'lambda', session: 'source' })
    expect(title(el)).toBe('λ · program')

    pane.setDetached(true)
    expect(title(el)).toContain('copy · not linked')

    pane.setDetached(false)
    expect(title(el)).toBe('λ · program')
    expect(title(el)).not.toContain('not linked')
  })

  it('appears on the TM view when detached and is gone when reattached', () => {
    const el = host()
    const pane = new TmPane(el, EVENTS)
    pane.setBindings([program('tm')], { leg: 'tm', session: 'source' })
    expect(title(el)).toBe('TM · program')

    pane.setDetached(true)
    expect(title(el)).toContain('copy · not linked')

    pane.setDetached(false)
    expect(title(el)).toBe('TM · program')
    expect(title(el)).not.toContain('not linked')
  })

  // §4.3'S NORMAL CASE, NOT AN EDGE ONE. Editing a copy rebinds THAT view; the program keeps running and
  // the other view stays on it. A status owned by shared chrome, or driven off one app-wide boolean,
  // would light both.
  it('marks only the view that detached', () => {
    const lambdaHost = host()
    const tmHost = host()
    const lambda = new LambdaPane(lambdaHost, EVENTS)
    const tm = new TmPane(tmHost, EVENTS)
    lambda.setBindings([program('lambda')], { leg: 'lambda', session: 'source' })
    tm.setBindings([program('tm')], { leg: 'tm', session: 'source' })

    lambda.setDetached(true)
    // SET EXPLICITLY, not left at the constructor's default — a caller that drives both views every
    // frame is the case this asserts, and "never called" is already covered by the first two `it`s.
    tm.setDetached(false)

    expect(title(lambdaHost)).toContain('copy · not linked')
    expect(title(tmHost)).toBe('TM · program')
    expect(title(tmHost)).not.toContain('not linked')
  })

  // The setter is on the per-frame path (`PaneSlot.render` calls it for every view on every recorded
  // frame during playback), so repeating the current value must not append a second status.
  it('does not stack statuses when set twice', () => {
    const el = host()
    const pane = new LambdaPane(el, EVENTS)
    pane.setBindings([program('lambda')], { leg: 'lambda', session: 'source' })

    pane.setDetached(true)
    pane.setDetached(true)
    expect(statusCount(el)).toBe(1)

    pane.setDetached(false)
    pane.setDetached(false)
    expect(statusCount(el)).toBe(0)
  })

  /**
   * THE STYLESHEET'S CARRIER IS GEOMETRY, NOT HUE, AND THAT IS ASSERTED RATHER THAN COMMENTED. §4.5
   * rejected a colour treatment because hue was then the sole discriminator for five states
   * (accessibility item 7), so the status rule must survive a reader who cannot tell its colour from
   * the title's. A border is that carrier; a rule reduced to `color:` alone fails here.
   *
   * The browser tier loads `style.css` (`tests/browser/setup.ts`), so this also catches the rule never
   * reaching the page at all — the same gap that file exists for.
   */
  it('is drawn with a non-colour carrier', () => {
    const el = host()
    const pane = new LambdaPane(el, EVENTS)
    pane.setBindings([program('lambda')], { leg: 'lambda', session: 'source' })
    pane.setDetached(true)

    const status = el.querySelector('h2 .view-status')
    expect(status?.textContent).toBe('copy · not linked')
    if (status === null) return

    const style = getComputedStyle(status)
    expect(style.borderTopStyle).not.toBe('none')
    expect(Number.parseFloat(style.borderTopWidth)).toBeGreaterThan(0)
  })
})
