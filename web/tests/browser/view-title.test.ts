import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { History } from '../../src/history'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { Leg } from '../../src/protocol'
import type { SessionId } from '../../src/session-client'
import type { Binding, LegState, SessionEntry } from '../../src/sessions'
import { PaneSlot, SessionRegistry } from '../../src/sessions'
import type { LambdaState, TmState } from '../../src/types'
import { bindingKey } from '../../src/view-header'
import { fakeClient, paint } from '../node/session-fixtures'
import { newPaneHost, rect, SHELL, stateIdle, until, viewTitleOf } from './harness'
import { chooseFromWorkspace, userSplit } from './user-event-fixture'

/**
 * TWO PANES BOUND TO TWO DIFFERENT λ SESSIONS, RENDERING TWO DIFFERENT TERMS AT THE SAME TIME, in a real
 * DOM against the real `LambdaPane`: the resolution and the rendering.
 *
 * THE REGISTRY IS BUILT HERE AND THE PRODUCTION PATH IS SHARED RATHER THAN RE-IMPLEMENTED.
 * The `draw()` that `draw.ts`'s `createDraw` builds is, for each pane, `slot.resolve(reg)` followed by
 * `slot.render(reg, pane, leg)` — the two calls `paint` below makes. Resolution, `controlState` and the
 * selector's option list all live inside `PaneSlot.render`, so nothing about what a binding MEANS is restated in
 * this file.
 *
 * `tests/node/sessions.test.ts` ASSERTS THE SAME CLAIM WITHOUT A DOM and is not redundant with this.
 * That tier drives recording fakes and says which binding resolved to which leg; this one says the
 * text a user would read is different in the two panes, and that the control which moves a binding is
 * on the page, is text, and works.
 *
 * Section citations here are the 5d-i design's unless they name another.
 */

const SOURCE: SessionId = 'source'
const SECOND: SessionId = 'second'

/** A λ-only session whose single recorded frame prints `text`. The text is the discriminator. */
function lambdaSession(id: SessionId, label: string, text: string): SessionEntry {
  const hist = new History<LambdaState>(1_000_000)
  hist.push({ text, spans: new Uint8Array(), cut: null, step: 0, redex_span: null, owner: 'None' }, 1)
  const leg: LegState<LambdaState> = {
    hist,
    status: { available: true, reason: '' },
    done: null,
    playing: false,
    epoch: 0,
    gen: 0,
  }
  return {
    id,
    label,
    client: fakeClient(),
    legs: { lambda: leg },
    programs: { rxm: null, tm: null, clif: null },
  }
}

/**
 * A session with a λ and a TM leg, one the λ-only helper above cannot make. It exists for the
 * grouped-pairs test alone: a registry in which every session is λ-only can never offer a TM pair, so
 * the omission it asserts would hold vacuously.
 */
function bothLegs(id: SessionId, label: string, text: string): SessionEntry {
  const lambdaHist = new History<LambdaState>(1_000_000)
  lambdaHist.push({ text, spans: new Uint8Array(), cut: null, step: 0, redex_span: null, owner: 'None' }, 1)
  const tmHist = new History<TmState>(1_000_000)
  tmHist.push(
    { state: 0, step: 0, heads: [0], window_start: [0], window: ['_'], source_node: null, rule: null, result: null },
    1,
  )
  const ok = { available: true, reason: '' }
  return {
    id,
    label,
    client: fakeClient(),
    legs: {
      lambda: { hist: lambdaHist, status: ok, done: null, playing: false, epoch: 0, gen: 0 },
      tm: { hist: tmHist, status: ok, done: null, playing: false, epoch: 0, gen: 0 },
    },
    // A TM LEG WITH NO MACHINE BEHIND IT, WHICH IS A STATE THE APP HAS TOO — between registering the
    // source session and its first `compiled` reply. The panes here are built directly rather than by
    // `pane-host.ts`, so nothing in this file reads it.
    programs: { rxm: null, tm: null, clif: null },
  }
}

/** The term the pane is showing, read the way a user reads it. */
const term = (pane: HTMLElement) => pane.querySelector('.term')?.textContent ?? ''

/** The title's menu. */
const menuOf = (pane: HTMLElement) => document.getElementById(viewTitleOf(pane)?.getAttribute('aria-controls') ?? '')

/** Pick `key` (`bindingKey(leg, session)`) through the view's title menu, as a user does. */
function pickBinding(pane: HTMLElement, key: string): void {
  const title = viewTitleOf(pane)
  if (title === null) throw new Error('no title-selector on this view')
  title.click()
  const item = menuOf(pane)?.querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
  if (item == null) {
    const offered = [...(menuOf(pane)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map(
      (b) => b.dataset.binding,
    )
    throw new Error(`the view offers no ${JSON.stringify(key)} — offered: ${JSON.stringify(offered)}`)
  }
  item.click()
}

/** Every pair the view's title menu offers, as `[key, text]` — opens and closes the menu to read it. */
function offered(pane: HTMLElement): [string, string][] {
  const title = viewTitleOf(pane)
  if (title === null) return []
  title.click()
  const items = [...(menuOf(pane)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b): [string, string] => [
    b.dataset.binding ?? '',
    b.textContent ?? '',
  ])
  menuOf(pane)?.hidePopover()
  return items
}

/** `PaneEvents`'s nine required members. `rebind` is the only one any test here fires. */
const events = (slot: PaneSlot<'lambda'>, after: () => void): PaneEvents => ({
  back: () => undefined,
  forward: () => undefined,
  toNewest: () => undefined,
  play: () => undefined,
  restart: () => undefined,
  extend: () => undefined,
  speed: () => 8,
  setSpeed: () => undefined,
  // THE SESSION ONLY, THOUGH THE PICK CARRIES A LEG — `PaneSlot<K>`'s leg is fixed at construction and
  // has no writer, so this is the whole of what a same-leg pick can do. It is also exactly what
  // `transport.ts`'s production handler does. A cross-leg pick is answered in `pane-host.ts`, which
  // changes the LEAF's kind and rebuilds the entry. That needs a layout tree and these hand-built panes
  // have none, which is why this harness answers only the axis it can reach;
  // `tests/browser/pane-kind-switch.test.ts` drives the other one through the mounted app.
  rebind: (binding: Binding<Leg>) => {
    slot.rebind(binding.session)
    after()
  },
})

describe('the title-selector', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  /**
   * Both panes are painted before either is asserted, and both are asserted before anything is rebound —
   * a "bind, read, rebind, read" sequence would pass on an implementation with one live session and a
   * mutable global, which is what "at the same time" rules out.
   *
   * THE TERMS DIFFER ON PURPOSE, the discriminator `pool-isolation.test.ts` uses for three sessions'
   * answers: two panes showing the same term would look identical whether or not the bindings were
   * honoured, so the assertion has to be on the value.
   */
  it('renders two different λ sessions side by side, at the same time', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'program', '(λx. x) 1'))
    reg.add(lambdaSession(SECOND, 'second', '(λy. y y) 2'))

    const leftHost = newPaneHost()
    const rightHost = newPaneHost()
    const left = new PaneSlot('lambda', SOURCE)
    const right = new PaneSlot('lambda', SECOND)
    const leftPane = new LambdaPane(
      leftHost,
      events(left, () => undefined),
    )
    const rightPane = new LambdaPane(
      rightHost,
      events(right, () => undefined),
    )

    paint(reg, left, leftPane)
    paint(reg, right, rightPane)

    expect(term(leftHost)).toBe('(λx. x) 1')
    expect(term(rightHost)).toBe('(λy. y y) 2')
    // Said as an inequality too: a mutation that resolves every binding to the source session leaves
    // both panes reading `(λx. x) 1`, and this is the line that names that failure.
    expect(term(leftHost)).not.toBe(term(rightHost))
  })

  /**
   * THE CONTROL IS ABSENT WHILE IT COULD DO NOTHING, which is `step-controls.ts`'s stated idiom (added
   * and removed, never disabled) and §4.5's standard (a thing that provably cannot work should not be
   * presented as though it might).
   *
   * **THE RUNNING APP DOES NOT REACH IT.** The selector lists `(leg, session)` PAIRS, and `main.ts`
   * registers the program session with all three legs, so `pairs()` contributes three on its own and the
   * plain-text branch is unreachable in the running app (`main.ts`'s own comment on the registration says
   * so). What reaches it here is this file's λ-ONLY source session, a shape the app never builds. The
   * branch is worth holding, because `viewHeader` offers it and a later leg arrangement could reach it.
   */
  it('is a button that opens its choices only once a second session offers this leg', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'program', 'a'))

    const el = newPaneHost()
    const slot = new PaneSlot('lambda', SOURCE)
    const pane = new LambdaPane(
      el,
      events(slot, () => paint(reg, slot, pane)),
    )

    paint(reg, slot, pane)
    expect(viewTitleOf(el)).toBeNull()
    expect(el.querySelector('h2 span.view-title')?.textContent).toBe('λ · program')

    reg.add(lambdaSession(SECOND, 'second', 'b'))
    paint(reg, slot, pane)
    expect(viewTitleOf(el)).not.toBeNull()
    // NAMED BY TEXT, NOT BY COLOUR OR POSITION: the sessions are told apart by their labels — which is
    // also what a screen reader gets. An implementation that distinguished them any other way would leave
    // these strings unset.
    expect(offered(el).map(([, text]) => text)).toEqual(['λ · program', 'λ · second'])
    expect(viewTitleOf(el)?.dataset.binding).toBe(bindingKey('lambda', SOURCE))
    // A DISCLOSURE, NOT A MENU BUTTON: it names the popover it opens and claims no menu, whose arrow keys it has not.
    expect(viewTitleOf(el)?.hasAttribute('aria-haspopup')).toBe(false)
    expect(viewTitleOf(el)?.getAttribute('aria-controls')).toMatch(/^view-title-menu-/)
  })

  /**
   * THE CONTROL ACTUALLY MOVES THE BINDING, driven through the DOM rather than by calling `rebind`.
   * Everything above this asserts what a binding does once it has moved; this is the one that says a
   * user can move it — and it is the path `transport.ts` wires (`events(...).rebind` calls `slot.rebind`
   * then `draw()`), reproduced here by the `after` callback repainting.
   */
  it('rebinds the pane when a session is picked, and follows it back', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'program', 'from source'))
    reg.add(lambdaSession(SECOND, 'second', 'from second'))

    const el = newPaneHost()
    const slot = new PaneSlot('lambda', SOURCE)
    const pane = new LambdaPane(
      el,
      events(slot, () => paint(reg, slot, pane)),
    )
    paint(reg, slot, pane)
    expect(term(el)).toBe('from source')

    pickBinding(el, bindingKey('lambda', SECOND))

    expect(slot.binding).toEqual({ session: SECOND, leg: 'lambda' })
    expect(term(el)).toBe('from second')
    expect(viewTitleOf(el)?.dataset.binding).toBe(bindingKey('lambda', SECOND))

    pickBinding(el, bindingKey('lambda', SOURCE))
    expect(term(el)).toBe('from source')
    expect(el.querySelector('h2')?.textContent).toBe('λ · program')
  })

  /**
   * **THE TITLE KEEPS THE FOCUS ACROSS THE PICK IT PERFORMED** — Plan 7 part 2 spec §11, "focus never
   * falls to `<body>`", and umbrella §4 rule 5.
   *
   * **THIS IS THE ONE GESTURE WITH NO `focusPane` BEHIND IT**, deliberately: `pane-host.ts`'s same-leg
   * `rebind` arm leaves focus alone because the view is still there and only its contents changed. That
   * makes the header's own repaint the whole of the guarantee — and a repaint that takes the title out of
   * the document and puts it back does not keep it, however identical the element is afterwards. So this
   * asserts the FOCUS, not the identity: the element is the same either way.
   */
  it('keeps the focus on the title it was picked from', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'program', 'from source'))
    reg.add(lambdaSession(SECOND, 'second', 'from second'))

    const el = newPaneHost()
    const slot = new PaneSlot('lambda', SOURCE)
    const pane = new LambdaPane(
      el,
      events(slot, () => paint(reg, slot, pane)),
    )
    paint(reg, slot, pane)

    const title = el.querySelector<HTMLButtonElement>('button.view-title')
    title?.focus()
    expect(document.activeElement).toBe(title)

    pickBinding(el, bindingKey('lambda', SECOND))

    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(el.querySelector('button.view-title'))
  })

  // The title sits on the per-frame path (`draw()` repaints every view on every recorded frame
  // during playback), so a repeat render must not rebuild the heading — rebuilding it takes the menu
  // out of the DOM, which closes it under a user in the middle of choosing. Asserted on the open menu
  // and by identity, which is the only thing that distinguishes "left alone" from "replaced with an
  // equal one".
  it('does not rebuild when nothing changed, so an open menu survives a frame', () => {
    const reg = new SessionRegistry()
    reg.add(lambdaSession(SOURCE, 'program', 'a'))
    reg.add(lambdaSession(SECOND, 'second', 'b'))

    const el = newPaneHost()
    const slot = new PaneSlot('lambda', SOURCE)
    const pane = new LambdaPane(
      el,
      events(slot, () => undefined),
    )

    paint(reg, slot, pane)
    viewTitleOf(el)?.click()
    const first = menuOf(el)?.querySelector('button')
    paint(reg, slot, pane)
    paint(reg, slot, pane)
    expect(menuOf(el)?.matches(':popover-open')).toBe(true)
    expect(menuOf(el)?.querySelectorAll('button').length).toBe(2)
    expect(menuOf(el)?.querySelector('button')).toBe(first)
    menuOf(el)?.hidePopover()
  })

  /**
   * THE CONTROL OFFERS `(leg, session)` PAIRS, NOT SESSIONS, asserted on the two things that distinguish
   * a pair list from a session list: the legs are GROUPED, and a pair naming a leg its session does not
   * have is ABSENT rather than present-and-broken.
   *
   * THE SECOND SESSION IS λ-ONLY AND THE SOURCE HAS BOTH, which is why the omission is observable at all.
   * `SessionRegistry.legOf` THROWS on a binding naming a leg the session lacks, so an option for
   * `(tm, second)` would be an option that crashes the next render — the reason 5d-ii-b design
   * §3.2's axes are not independent and the reason this is one control rather than two.
   *
   * READ AS THE MENU'S ITEMS IN ORDER — the grouping is the order. The λ pairs come first because
   * `SessionRegistry.pairs()` walks `LEGS` in that order, which is a value rather than a key walk for
   * exactly this reason.
   */
  it('lists both legs, grouped, and omits a pair the session has no leg for', () => {
    const reg = new SessionRegistry()
    reg.add(bothLegs(SOURCE, 'program', 'a'))
    reg.add(lambdaSession(SECOND, 'second', 'b'))

    const el = newPaneHost()
    const slot = new PaneSlot('lambda', SOURCE)
    const pane = new LambdaPane(
      el,
      events(slot, () => undefined),
    )
    paint(reg, slot, pane)

    const keys = offered(el).map(([key]) => key)
    expect(keys).toEqual([bindingKey('lambda', SOURCE), bindingKey('lambda', SECOND), bindingKey('tm', SOURCE)])
    // The second session has no TM leg, so the pair is not in the list at all.
    expect(keys.filter((k) => k.startsWith('tm:'))).toEqual([bindingKey('tm', SOURCE)])
  })
})

/**
 * **THE APP, MOUNTED ONCE AFTER THE CASES ABOVE**, which build their views by hand on a body they clear: the Debugger
 * preset, its rxm view split right into a second view of the program, as `⋯` *split right* makes one.
 */
describe('a view narrower than its title', () => {
  beforeAll(async () => {
    await page.viewport(1280, 800)
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(stateIdle, 'the first compile')
    await chooseFromWorkspace('[data-preset="debugger"]')
    const added = await userSplit('rxm-0', bindingKey('rxm', 'source'))
    if (added === null) throw new Error('the split added no second rxm view')
  })

  /** The width of `text`'s own words, which a `Range` measures whatever its box clips. */
  const textWidth = (text: Element): number => {
    const range = document.createRange()
    range.selectNodeContents(text)
    return range.getBoundingClientRect().width
  }

  /**
   * **THE TITLE IS CUT, ON ONE LINE AND INSIDE THE VIEW**, rather than wrapping word by word. The view is made
   * narrower than its title's text by narrowing the page, which is asserted first, for each of the two views.
   *
   * **320 PX**: the two split views share the half of the row the rxm view had, so each is narrower there than its
   * title's text, which the case waits for before it reads anything.
   */
  it('cuts the title with an ellipsis on one line, inside the view', async () => {
    const views = [...document.querySelectorAll<HTMLElement>('.pane[data-kind="rxm"]')]
    expect(views).toHaveLength(2)
    const titled = (v: HTMLElement) => v.querySelector('.view-title-text') as HTMLElement
    // EACH TITLE'S WIDTH ON ONE LINE, READ WHILE THE VIEWS STILL HAVE ROOM FOR IT.
    await document.fonts.ready
    const whole = views.map((v) => textWidth(titled(v)))
    await page.viewport(320, 800)
    await until(() => views.every((v, i) => rect(v).width < (whole[i] ?? 0)), 'the page to narrow the views')
    for (const v of views) {
      const text = titled(v)
      expect(rect(text).height, 'the title is one line').toBeLessThan(
        2 * Number.parseFloat(getComputedStyle(text).fontSize),
      )
      expect(text.scrollWidth, 'the title is cut').toBeGreaterThan(text.clientWidth)
      expect(getComputedStyle(text).textOverflow, 'the cut ends in an ellipsis').toBe('ellipsis')
      expect(rect(v.querySelector('.view-title')).right, 'the title stays inside its view').toBeLessThanOrEqual(
        rect(v).right + 0.5,
      )
    }
    await page.viewport(1280, 800)
  })
})
