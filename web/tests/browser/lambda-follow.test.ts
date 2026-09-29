import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
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

const frame: LambdaState = { text: 'λx. x', spans: [], cut: null, step: 0, redex_span: null, owner: 'None' }
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
 * REAL GESTURES WHERE THERE IS ONE: the window is resized with `page.viewport`, and the view is taken off the page
 * and put back as Stage does, with its host. Each `scroll` a case is about is awaited, not counted in frames.
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
