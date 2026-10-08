import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cdp, page } from 'vitest/browser'
import { LINE_HEIGHT } from '../../src/lambda-body'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { LambdaState } from '../../src/types'
import { wireOf } from '../node/tree-fixture'
import { until } from './harness'

/**
 * The λ view's `follow redex` header action (spec §5.3). The pane is built directly, as `lambda-display`'s
 * are — nothing here needs `main()`.
 */
const host = (): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane lambda-follow-fixture'
  el.style.width = '640px'
  document.body.append(el)
  return el
}

const events = (): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
})

const frame: LambdaState = {
  text: 'λx. x',
  spans: new Uint8Array(),
  cut: null,
  step: 0,
  redex_span: null,
  owner: 'None',
}
const CONTROLS = {
  canRestart: true,
  canBack: false,
  canForward: true,
  canPlay: true,
  playing: false,
  stepText: '0',
  continueLabel: null,
}

/** `f a0 … a399`, then a redex last: a spine of one argument per line, far taller than the view. */
const TALL = `f ${Array.from({ length: 400 }, (_, i) => `a${i}`).join(' ')} ((\\y. y) z)`

/** Two animation frames: long enough for the browser to deliver a scroll's own event. */
const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

afterEach(() => {
  for (const el of document.querySelectorAll('.lambda-follow-fixture')) el.remove()
})

describe('a λ view’s follow redex action', () => {
  /**
   * THE ACTION EXISTS ONLY WHILE THE VIEW IS DETACHED, added and removed as the TM view's `follow current
   * rule` is. A user scroll detaches it; the click re-attaches, redraws on the redex, and leaves the focus
   * on the term it acts on rather than on a button that has just hidden itself.
   */
  it('appears once a user scroll detaches the view, and re-attaches it', async () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(TALL) })
    await frames()
    const term = el.querySelector('.term') as HTMLElement
    const follow = [...el.querySelectorAll('button')].find((b) => b.textContent === 'follow redex')
    expect(follow, 'the action is built').toBeDefined()
    expect(follow?.hidden, 'while following').toBe(true)
    const followed = term.scrollTop
    expect(followed).toBeGreaterThan(0)

    term.scrollTop = 0
    await frames()
    expect(follow?.hidden, 'once the user scrolled away').toBe(false)
    expect(follow?.closest('.view-header'), 'a header action').not.toBeNull()

    follow?.focus()
    follow?.click()
    expect(term.scrollTop).toBe(followed)
    expect(el.querySelector('.term .is-next-redex')).not.toBeNull()
    expect(follow?.hidden, 'following again').toBe(true)
    expect(document.activeElement).toBe(term)
  })

  /**
   * NO TREE, NOTHING TO FOLLOW. A user who scrolls a long flat text detaches the view by design, so the next
   * tree is not pulled away from where they are; the action comes with that tree, not before it.
   */
  it('is not offered while the view shows flat text', async () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    const long: LambdaState = { ...frame, text: `λx. ${'x '.repeat(6000)}` }
    pane.render(long, CONTROLS)
    pane.renderTree({ kind: 'none' })
    const term = el.querySelector('.term') as HTMLElement
    const follow = [...el.querySelectorAll('button')].find((b) => b.textContent === 'follow redex')
    expect(term.scrollHeight, 'the flat text scrolls').toBeGreaterThan(term.clientHeight)
    term.scrollTop = 200
    await frames()
    expect(follow?.hidden, 'detached, over flat text').toBe(true)
    pane.renderTree({ kind: 'tree', tree: wireOf(TALL) })
    expect(follow?.hidden, 'detached, over a tree').toBe(false)
    pane.renderTree({ kind: 'none' })
    expect(follow?.hidden, 'over flat text again').toBe(true)
  })

  /** The umbrella's header order: a view's own actions, then `⋯`, then `✕` — however often those two come and go. */
  it('sits before ⋯ and ✕ in the header', () => {
    const el = host()
    const pane = new LambdaPane(el, { ...events(), close: vi.fn(), splitRow: vi.fn(), splitColumn: vi.fn() })
    const choices = { options: [], sourceAvailable: false, current: null }
    const order = () =>
      [...(el.querySelector('.view-actions')?.children ?? [])]
        .map((c) => (c.textContent === 'follow redex' ? 'follow' : c.className))
        .filter((c) => c !== 'view-menu')
    pane.setLayoutControls(true, true, choices)
    expect(order()).toEqual(['follow', 'view-more', 'view-close'])
    pane.setLayoutControls(false, false, choices)
    pane.setLayoutControls(true, true, choices)
    expect(order(), 'after ⋯ and ✕ came back').toEqual(['follow', 'view-more', 'view-close'])
  })
})

/**
 * **THE BODY'S HEIGHT CHANGES WITH NO FRAME AND NO SCROLL TO REDRAW IT.** `.term` is capped at `60vh`, so a window
 * that grows grows the body with it, and nothing the view draws runs for that. A body following a redex near the
 * term's end then has its scroll clamped, and the browser reports the clamp as a `scroll`; a body following one in
 * the middle has a band below its drawn rows. And a body taken off the page — Stage shows one view at a time — can
 * be sent the `scroll` of its last draw's write after it has gone, where its `scrollTop` reads 0.
 *
 * REAL GESTURES WHERE THERE IS ONE: the view is taken off the page and put back as Stage does, with its host, and
 * each `scroll` a case is about is awaited, not counted in frames.
 *
 * **TWO RESIZES, BECAUSE THEY REACH THE BODY IN OPPOSITE ORDERS.** `page.viewport` sets the size of the iframe the
 * test runs in, from vitest's page around it; there, in every kept run, the body's resize observer was told of the
 * new height before the clamp's `scroll`. A resize of the WINDOW, as Playwright's `setViewportSize` makes one,
 * delivered the clamp's `scroll` first, before the observer could record it; that is `inWindow`'s case, which found
 * #115's λ body detaching.
 */
describe('a λ view whose box changes size under it', () => {
  /** `f a0 … a199`, the redex, then `a200 … a399`: the redex in the middle of a term far taller than the view. */
  const args = (from: number) => Array.from({ length: 200 }, (_, i) => `a${from + i}`).join(' ')
  const MIDDLE = `f ${args(0)} ((\\y. y) z) ${args(200)}`
  const scrolled = (el: HTMLElement) =>
    new Promise<void>((r) => el.addEventListener('scroll', () => r(), { once: true }))

  function mount(term: string): { body: HTMLElement; follow: HTMLButtonElement } {
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(term) })
    const body = el.querySelector('.term') as HTMLElement
    const follow = [...el.querySelectorAll('button')].find((b) => b.textContent === 'follow redex') as HTMLButtonElement
    return { body, follow }
  }
  /** Whether the redex's first token lies wholly inside the body's box, as it is drawn. */
  const redexShown = (body: HTMLElement) => {
    const redex = body.querySelector('.is-next-redex')
    if (redex === null) return false
    const a = redex.getBoundingClientRect()
    const b = body.getBoundingClientRect()
    return a.height > 0 && a.top >= b.top && a.bottom <= b.bottom
  }

  beforeEach(async () => {
    await page.viewport(1280, 600)
  })

  /**
   * Call `run` in a WINDOW `from` pixels tall, handing it `grow`, which makes the window `to` pixels tall: the
   * top-level page's viewport, through CDP's `Emulation.setDeviceMetricsOverride`, the command Playwright's
   * `setViewportSize` sends, with the test's iframe sized to that viewport.
   *
   * **BOTH ARE PUT BACK, AND THE WINDOW IS WAITED FOR UNTIL IT IS**, so the files after this one run in the page they
   * expect: the frame's style first, which cannot throw, then the viewport, screen, scale and orientation that
   * Playwright's own override sets for a desktop page, each read from the page before this one changed anything.
   */
  async function inWindow(from: number, run: (grow: (to: number) => Promise<void>) => Promise<void>): Promise<void> {
    const box = (window.frameElement as HTMLElement).parentElement as HTMLElement
    const saved = box.style.cssText
    const top = window.parent
    const now = () => ({
      width: top.innerWidth,
      height: top.innerHeight,
      screenWidth: top.screen.width,
      screenHeight: top.screen.height,
      deviceScaleFactor: top.devicePixelRatio,
      orientation: { angle: top.screen.orientation.angle, type: top.screen.orientation.type },
    })
    const was = now()
    const session = cdp()
    const set = (width: number, height: number) =>
      session.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        screenWidth: was.screenWidth,
        screenHeight: was.screenHeight,
        deviceScaleFactor: was.deviceScaleFactor,
        mobile: false,
        // THE DOM SAYS `landscape-primary`, CDP `landscapePrimary`.
        screenOrientation: {
          angle: was.orientation.angle,
          type: was.orientation.type.replace(/-(\w)/, (_, c: string) => c.toUpperCase()) as
            | 'landscapePrimary'
            | 'landscapeSecondary'
            | 'portraitPrimary'
            | 'portraitSecondary',
        },
      })
    let failed: { readonly error: unknown } | null = null
    try {
      box.style.cssText = 'width: 100vw; height: 100vh; transform: none;'
      await set(900, from)
      await until(() => innerHeight === from, 'the window to take its height')
      await run(async (to) => {
        await set(900, to)
        await until(() => innerHeight === to, 'the window to grow')
      })
    } catch (error) {
      failed = { error }
    }
    try {
      box.style.cssText = saved
      await set(was.width, was.height)
      await until(() => JSON.stringify(now()) === JSON.stringify(was), 'the page to be as it was')
    } catch (restore) {
      // THE CASE'S OWN FAILURE IS NOT REPLACED BY THE RESTORE'S: both are reported, the case's first.
      if (failed !== null) throw new AggregateError([failed.error, restore], 'the case failed, and so did the restore')
      throw restore
    }
    if (failed !== null) throw failed.error
  }

  it('stays following when the WINDOW grows and its clamp is reported before its resize', async () => {
    await inWindow(600, async (grow) => {
      const { body, follow } = mount(TALL)
      await frames()
      // Following, and at the end: the redex is the term's last line, so the scroll is as far down as it goes.
      expect(follow.hidden).toBe(true)
      expect(body.scrollTop + body.clientHeight).toBe(body.scrollHeight)
      const before = { top: body.scrollTop, height: body.clientHeight }
      // THE ORDER THIS CASE IS ABOUT, OBSERVED RATHER THAN ASSUMED: the clamp's `scroll`, then the resize report.
      const order: string[] = []
      body.addEventListener('scroll', () => order.push('scroll'), { once: true })
      const reported = new Promise<void>((r) => {
        const o = new ResizeObserver(() => {
          if (body.clientHeight === before.height) return
          order.push('resize')
          o.disconnect()
          r()
        })
        o.observe(body)
      })
      await grow(1000)
      await reported
      await frames()
      expect(body.clientHeight, 'the body grew with the window').toBeGreaterThan(before.height)
      expect(body.scrollTop, 'and its scroll was clamped').toBeLessThan(before.top)
      expect(order, 'the clamp reported before the resize').toEqual(['scroll', 'resize'])
      expect(follow.hidden, 'the clamp was not the user scrolling').toBe(true)
      expect(redexShown(body)).toBe(true)
    })
  })

  it('stays following when the window grows and the browser clamps its scroll', async () => {
    const { body, follow } = mount(TALL)
    await frames()
    // Following, and at the end: the redex is the term's last line, so the scroll is as far down as it goes.
    expect(follow.hidden).toBe(true)
    expect(body.scrollTop + body.clientHeight).toBe(body.scrollHeight)
    const before = { top: body.scrollTop, height: body.clientHeight }
    const clamp = scrolled(body)
    await page.viewport(1280, 900)
    await until(() => body.clientHeight > before.height, 'the body to grow with the window')
    // THE PRECONDITION: the scroll was clamped, so the browser has a `scroll` of its own to report.
    expect(body.scrollTop).toBeLessThan(before.top)
    await clamp
    await frames()
    expect(follow.hidden, 'the clamp was not the user scrolling').toBe(true)
    expect(redexShown(body)).toBe(true)
  })

  /**
   * **A SCROLL OF FLAT TEXT IS THE USER'S, WHATEVER HEIGHT THE LAST TREE HAD.** The scroll handler reads a box whose
   * height changed since it was laid out as a clamp, so flat text records its own height: the browser lays it out,
   * not `#paint`. Here a tree shorter than the body's cap gives way to flat text as tall as the cap, and then the
   * window grows under the flat text; after each, a scroll of the user's takes control, as it does of a tree.
   */
  describe('flat text', () => {
    /** `f argument0 … argument11`, then a redex: a line per argument, shorter than the body's cap. */
    const SHORT = `f ${Array.from({ length: 12 }, (_, i) => `argument${i}`).join(' ')} ((\\y. y) z)`
    const LONG: LambdaState = { ...frame, text: `λx. ${'x '.repeat(6000)}` }

    function flatAfter(term: string): { pane: LambdaPane; body: HTMLElement; follow: HTMLButtonElement } {
      const el = host()
      const pane = new LambdaPane(el, events())
      pane.render(LONG, CONTROLS)
      pane.renderTree({ kind: 'tree', tree: wireOf(TALL) })
      if (term !== TALL) pane.renderTree({ kind: 'tree', tree: wireOf(term) })
      const body = el.querySelector('.term') as HTMLElement
      const follow = [...el.querySelectorAll('button')].find(
        (b) => b.textContent === 'follow redex',
      ) as HTMLButtonElement
      return { pane, body, follow }
    }

    it('takes a scroll of flat text taller than the tree before it as the user’s', async () => {
      const { pane, body, follow } = flatAfter(SHORT)
      await frames()
      const tree = body.clientHeight
      pane.renderTree({ kind: 'none' })
      await frames()
      expect(body.clientHeight, 'the flat text is taller than the tree was').toBeGreaterThan(tree)
      body.scrollTop = 200
      await frames()
      pane.renderTree({ kind: 'tree', tree: wireOf(TALL) })
      expect(follow.hidden, 'the scroll took control').toBe(false)
    })

    it('takes a scroll of flat text as the user’s after the window grows it', async () => {
      const { pane, body, follow } = flatAfter(TALL)
      await frames()
      pane.renderTree({ kind: 'none' })
      await frames()
      const before = body.clientHeight
      await page.viewport(1280, 900)
      await until(() => body.clientHeight > before, 'the flat text to grow with the window')
      await frames()
      body.scrollTop = 200
      await frames()
      pane.renderTree({ kind: 'tree', tree: wireOf(TALL) })
      expect(follow.hidden, 'the scroll took control').toBe(false)
    })
  })

  it('draws the rows the grown box shows, and keeps the redex centred', async () => {
    const { body, follow } = mount(MIDDLE)
    await frames()
    expect(follow.hidden).toBe(true)
    const before = body.clientHeight
    await page.viewport(1280, 900)
    await until(() => body.clientHeight > before, 'the body to grow with the window')
    await frames()
    const box = body.getBoundingClientRect()
    const lines = [...body.querySelectorAll<HTMLElement>('.term-line')].map((l) => l.getBoundingClientRect())
    // NO BAND WITHOUT ROWS: the drawn lines reach both edges of the box as it now is.
    expect(Math.min(...lines.map((l) => l.top))).toBeLessThanOrEqual(box.top)
    expect(Math.max(...lines.map((l) => l.bottom))).toBeGreaterThanOrEqual(box.bottom)
    const redex = (body.querySelector('.is-next-redex') as HTMLElement).getBoundingClientRect()
    expect(Math.abs((redex.top + redex.bottom) / 2 - (box.top + box.bottom) / 2)).toBeLessThanOrEqual(LINE_HEIGHT)
    expect(follow.hidden).toBe(true)
  })

  it('comes back following, on its redex, when it is taken off the page before its scroll is reported', async () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.render(frame, CONTROLS)
    await frames()
    const body = el.querySelector('.term') as HTMLElement
    const follow = [...el.querySelectorAll('button')].find((b) => b.textContent === 'follow redex') as HTMLButtonElement
    // The draw scrolls to the redex, and in the same task the view leaves the page, as a Stage tab chosen between two
    // frames of a run takes it: the draw's `scroll` is reported to a box that is no longer there.
    const echo = scrolled(body)
    pane.renderTree({ kind: 'tree', tree: wireOf(TALL) })
    expect(body.scrollTop).toBeGreaterThan(0)
    el.remove()
    await echo
    document.body.append(el)
    await frames()
    expect(follow.hidden, 'the echo was not the user scrolling').toBe(true)
    expect(redexShown(body)).toBe(true)
  })
})
