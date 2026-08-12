import { beforeEach, describe, expect, it } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import { TmPane } from '../../src/tm-pane'

/**
 * Design §4.5's SECOND surface: the pane is self-describing when the status line is off-screen or the
 * user is looking straight at the pane. The FIRST surface — the sentence in `#link-status` — is
 * `tests/node/link-status.test.ts`; §4.5 says the both-surfaces test splits by runner, and this is
 * the half that needs a DOM.
 *
 * THE PANES ARE CONSTRUCTED DIRECTLY HERE, not driven through `main()` the way every other browser
 * test in this directory is. Two reasons, and the second is the one that decides it: a badge is chrome
 * built in the constructor, so nothing about compiling, stepping or linking is on the path to it; and
 * `main.ts` has no way to detach a pane yet (§3.2b — there is no session registry, so no pane has a
 * binding to detach), so an app-level test would have nothing to click. Wiring the setter is one call
 * from `main.ts` once that lands; the affordance itself is finished and asserted now.
 *
 * **BOTH OF THOSE LANDED — T7 WIRED THE SETTER AND T8 BUILT THE CLICK — AND THE FIRST REASON IS WHY
 * THIS FILE STAYS AS IT IS.** `tests/browser/scratch-app.test.ts` now does the app-level version, and
 * it exercises the badge on exactly one pane in exactly one state. This file is the affordance itself:
 * both panes, set and unset, and the non-colour carriers §4.5 requires — none of which is on the path
 * of any app-level gesture.
 */
const noop = () => undefined

/** `PaneEvents`'s six required members, all inert — no test here clicks a control. */
const EVENTS: PaneEvents = { back: noop, forward: noop, play: noop, restart: noop, extend: noop, rebind: noop }

const host = () => {
  const el = document.createElement('section')
  el.className = 'pane'
  document.body.append(el)
  return el
}

/**
 * THE ASSERTION IS ON TEXT, WHICH IS THE WHOLE POINT (§5). Reading the `<h2>`'s `textContent` — not a
 * class, not a computed colour — is what makes an implementation that satisfies §4.5 with a sixth hue
 * fail: it would leave this string unchanged. `<h2>` is the pane's own title element, found by tag
 * rather than by any class the badge might carry.
 */
const title = (pane: HTMLElement) => pane.querySelector('h2')?.textContent ?? ''

/** How many times the badge's text occurs — 2 would mean a second badge was appended, not swapped. */
const badgeCount = (pane: HTMLElement) => title(pane).split('[detached]').length - 1

beforeEach(() => {
  document.body.replaceChildren()
})

describe('the [detached] badge', () => {
  // THE ATTACHED HALF IS THE HALF THAT CATCHES A BROKEN IMPLEMENTATION (§5): a badge that is appended
  // and never removed passes the middle assertion and fails the last. The first assertion covers the
  // third state — a pane whose setter was never called at all, which is every pane today.
  it('appears on the λ pane when detached and is gone when reattached', () => {
    const el = host()
    const pane = new LambdaPane(el, EVENTS)
    expect(title(el)).toBe('lambda')

    pane.setDetached(true)
    expect(title(el)).toContain('[detached]')

    pane.setDetached(false)
    expect(title(el)).toBe('lambda')
    expect(title(el)).not.toContain('detached')
  })

  it('appears on the TM pane when detached and is gone when reattached', () => {
    const el = host()
    const pane = new TmPane(el, EVENTS)
    expect(title(el)).toBe('turing machine')

    pane.setDetached(true)
    expect(title(el)).toContain('[detached]')

    pane.setDetached(false)
    expect(title(el)).toBe('turing machine')
    expect(title(el)).not.toContain('detached')
  })

  // §4.3'S NORMAL CASE, NOT AN EDGE ONE. Detaching one pane seeds a scratch and rebinds THAT pane; the
  // source session keeps running and the other pane stays bound to it. A badge owned by shared chrome,
  // or driven off one app-wide boolean, would light both.
  it('marks only the pane that detached', () => {
    const lambdaHost = host()
    const tmHost = host()
    const lambda = new LambdaPane(lambdaHost, EVENTS)
    const tm = new TmPane(tmHost, EVENTS)

    lambda.setDetached(true)
    // SET EXPLICITLY, not left at the constructor's default — a caller that drives both panes every
    // frame is the case this asserts, and "never called" is already covered by the first two `it`s.
    tm.setDetached(false)

    expect(title(lambdaHost)).toContain('[detached]')
    expect(title(tmHost)).not.toContain('detached')
  })

  // The setter is on the per-frame path once `main.ts` adopts it (`draw()` calls `renderLink` on every
  // recorded frame during playback), so repeating the current value must not append a second badge —
  // the same no-op guard `LambdaPane.renderLink` documents for the same reason.
  it('does not stack badges when set twice', () => {
    const el = host()
    const pane = new LambdaPane(el, EVENTS)

    pane.setDetached(true)
    pane.setDetached(true)
    expect(badgeCount(el)).toBe(1)

    pane.setDetached(false)
    pane.setDetached(false)
    expect(badgeCount(el)).toBe(0)
  })

  /**
   * THE STYLESHEET'S CARRIER IS GEOMETRY, NOT HUE, AND THAT IS ASSERTED RATHER THAN COMMENTED. §4.5
   * rejected a colour treatment because hue is already the sole discriminator for five states
   * (accessibility item 7), so the badge rule must survive a reader who cannot tell its colour from
   * the title's. A border is that carrier; a rule reduced to `color:` alone fails here.
   *
   * The browser tier loads `style.css` (`tests/browser/setup.ts`), so this also catches the rule never
   * reaching the page at all — the same gap that file exists for.
   */
  it('is drawn with a non-colour carrier', () => {
    const el = host()
    const pane = new LambdaPane(el, EVENTS)
    pane.setDetached(true)

    // Found by TEXT, not by class — the badge's identity in this test is what it says.
    const badge = [...(el.querySelector('h2')?.children ?? [])].find((c) => c.textContent === '[detached]')
    expect(badge).toBeDefined()
    if (badge === undefined) return

    const style = getComputedStyle(badge)
    expect(style.borderTopStyle).not.toBe('none')
    expect(Number.parseFloat(style.borderTopWidth)).toBeGreaterThan(0)
  })
})
