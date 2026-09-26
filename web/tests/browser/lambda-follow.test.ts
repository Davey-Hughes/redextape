import { afterEach, describe, expect, it, vi } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { LambdaState } from '../../src/types'
import { wireOf } from '../node/tree-fixture'

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
