import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { PaneOption } from '../../src/sessions'
import type { LambdaState } from '../../src/types'
import { DEFAULT_DISPLAY } from '../../src/workspace'
import { wireOf } from '../node/tree-fixture'

/**
 * A λ view's display settings (Plan 7 part 4a): the layout and the variables, chosen from its `⋯` menu,
 * reported so the app can keep them, "reset folds", and the reset a new binding makes. Panes are built
 * directly, as `lambda-pane-editor`'s are — nothing here needs `main()`.
 */
const host = (): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane lambda-display-fixture'
  el.style.width = '640px'
  document.body.append(el)
  return el
}

const events = (display = vi.fn()): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
  display,
})

const frame: LambdaState = { text: 'λx. λy. x', spans: [], cut: null, step: 0, redex_span: null, owner: 'None' }
const CONTROLS = {
  canRestart: true,
  canBack: false,
  canForward: true,
  canPlay: true,
  playing: false,
  stepText: '0',
  continueLabel: null,
}

const option = (id: string): PaneOption => ({ leg: 'lambda', id, label: id })
const WIDE = `g ${Array.from({ length: 40 }, (_, i) => `(a${i} b${i})`).join(' ')}`

const choice = (el: HTMLElement, value: string) =>
  el.querySelector<HTMLButtonElement>(`.view-menu-choice[data-value="${value}"]`)

afterEach(() => {
  for (const el of document.querySelectorAll('.lambda-display-fixture')) el.remove()
})

describe('a λ view’s display settings', () => {
  it('offers layout and variables in its menu as radio groups, checked to match what it draws', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf('\\x. \\y. x') })
    expect(el.querySelector<HTMLElement>('.term')?.dataset.layout).toBe('code')
    expect(el.querySelector('.term')?.textContent).toBe('λx y. x')
    expect(choice(el, 'names')?.getAttribute('aria-checked')).toBe('true')
    expect(choice(el, 'debruijn')?.getAttribute('aria-checked')).toBe('false')
    expect(el.querySelector('.view-menu-group[aria-label="layout"]')?.getAttribute('role')).toBe('radiogroup')
    expect(el.querySelector('.view-menu-group[aria-label="variables"]')?.getAttribute('role')).toBe('radiogroup')
    expect(choice(el, 'code')?.getAttribute('role')).toBe('radio')
    expect(choice(el, 'code')?.getAttribute('aria-checked')).toBe('true')
    expect(choice(el, 'outline')?.getAttribute('aria-checked')).toBe('false')
    expect(choice(el, 'code')?.hasAttribute('aria-pressed')).toBe(false)
  })

  /**
   * **THE SETTINGS ARE IN THE MENU FROM CONSTRUCTION.** Every other item reaches the menu through a setter
   * that sees a change, so a view whose other state never leaves its first value — here a copy, which
   * offers no *edit a copy*, with no editor to move to it — had no `⋯` at all, and no way to its layout,
   * its variables or "reset folds". The last line holds the header's order: `⋯` is mounted first now, and
   * the view's own action must still come before it.
   */
  it('offers its settings from construction, on a view whose other items never apply', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.setDetached(true)
    pane.render(frame, CONTROLS)
    expect(el.querySelector('button.view-more')).not.toBeNull()
    expect(el.querySelector('.view-menu-group[aria-label="layout"]')).not.toBeNull()
    expect(el.querySelector('.view-menu-group[aria-label="variables"]')).not.toBeNull()
    expect(el.querySelector('button.reset-folds')).not.toBeNull()
    const actions = [...(el.querySelector('.view-actions')?.children ?? [])].map((c) => c.className)
    expect(actions).toEqual(['term-reattach', 'view-more', 'view-menu'])
  })

  /**
   * **THE CHECKED CHOICE IS SEEN, AND NOT BY COLOUR ALONE.** `aria-checked` tells a reader; a sighted user
   * needs a rule that draws it, and one that survives a palette they cannot tell apart. `setup.ts` loads
   * `style.css` into the tester page, so these computed values are the rules the app ships.
   */
  it('draws the checked choice heavier than the others, not only in another colour', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.render(frame, CONTROLS)
    const weight = (value: string) => Number(getComputedStyle(choice(el, value) ?? el).fontWeight)
    expect(weight('code')).toBeGreaterThan(weight('outline'))
    expect(weight('names')).toBeGreaterThan(weight('debruijn'))
  })

  /**
   * **THE WAI-ARIA RADIO GROUP'S KEYS, THROUGH REAL KEY PRESSES** — `userEvent` drives the browser's own
   * input, so a Tab here is the browser's sequential navigation and not a guess at it. One tab stop per
   * group, on the checked choice; the arrows move to the next or previous choice and check it, wrapping;
   * the menu stays open, since a setting is chosen and then looked at. The reopen at the end is the
   * menu's focus hand-off: it lands on the choice checked now, not on the one it landed on last time.
   */
  it('is one tab stop per group, on the checked choice, and the arrows move to and check the next, wrapping', async () => {
    const el = host()
    const display = vi.fn()
    const pane = new LambdaPane(el, events(display))
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf('\\x. \\y. x') })
    const term = () => el.querySelector<HTMLElement>('.term')
    const menu = el.querySelector<HTMLElement>('.view-menu')
    const tabStops = () => [...el.querySelectorAll<HTMLElement>('.view-menu-choice')].map((b) => b.tabIndex)
    el.querySelector<HTMLButtonElement>('button.view-more')?.click()
    expect(document.activeElement, 'the menu opens on the checked choice').toBe(choice(el, 'code'))
    expect(tabStops()).toEqual([0, -1, 0, -1])

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(choice(el, 'outline'))
    expect(choice(el, 'outline')?.getAttribute('aria-checked')).toBe('true')
    expect(choice(el, 'code')?.getAttribute('aria-checked')).toBe('false')
    expect(tabStops()).toEqual([-1, 0, 0, -1])
    expect(display).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY, layout: 'outline' })
    expect(term()?.dataset.layout).toBe('outline')

    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement, 'past the last choice, the first').toBe(choice(el, 'code'))
    expect(choice(el, 'code')?.getAttribute('aria-checked')).toBe('true')
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement, 'before the first choice, the last').toBe(choice(el, 'outline'))
    await userEvent.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(choice(el, 'code'))
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(choice(el, 'outline'))
    expect(term()?.dataset.layout).toBe('outline')
    expect(menu?.matches(':popover-open'), 'a setting leaves the menu open').toBe(true)

    await userEvent.tab()
    expect(document.activeElement, 'Tab reaches the next group on its checked choice').toBe(choice(el, 'names'))
    await userEvent.tab()
    expect(document.activeElement).toBe(el.querySelector('button.reset-folds'))

    await userEvent.keyboard('{Escape}')
    expect(menu?.matches(':popover-open')).toBe(false)
    el.querySelector<HTMLButtonElement>('button.view-more')?.click()
    expect(document.activeElement, 'reopened, on the choice checked now').toBe(choice(el, 'outline'))
  })

  it('draws the outline and de Bruijn indices when they are picked, and reports each change', () => {
    const el = host()
    const display = vi.fn()
    const pane = new LambdaPane(el, events(display))
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf('\\x. \\y. x') })
    const term = () => el.querySelector<HTMLElement>('.term')
    expect(term()?.dataset.layout).toBe('code')
    expect(term()?.textContent).toBe('λx y. x')

    choice(el, 'outline')?.click()
    expect(display).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY, layout: 'outline' })
    expect(term()?.dataset.layout).toBe('outline')
    expect(choice(el, 'outline')?.getAttribute('aria-checked')).toBe('true')

    choice(el, 'debruijn')?.click()
    expect(display).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY, layout: 'outline', vars: 'debruijn' })
    expect(term()?.textContent).toBe('λ. λ. 1')
  })

  it('starts from the display it is given', () => {
    const el = host()
    const pane = new LambdaPane(el, events(), { display: { ...DEFAULT_DISPLAY, vars: 'debruijn' } })
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf('\\x. \\y. x') })
    expect(el.querySelector('.term')?.textContent).toBe('λ. λ. 1')
    expect(choice(el, 'debruijn')?.getAttribute('aria-checked')).toBe('true')
  })

  /**
   * **THE TERM HOLDS A SUBTERM OVER `AUTO_FOLD_NODES`, OR THE POLICY AND "EVERYTHING OPEN" ARE ONE PICTURE.**
   * This test drew `WIDE`, 161 nodes, which the policy draws fully open, so a reset that opened every fold
   * passed it. `h c0 … c109` is 221 nodes and the policy folds it; the reset has to put that fold back. It
   * sits on the second of three lines because the body draws only the rows in view, and `.term-line`
   * counts those.
   */
  it('resets folds to the automatic policy', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.render(frame, CONTROLS)
    pane.renderTree({
      kind: 'tree',
      tree: wireOf(`g (h ${Array.from({ length: 110 }, (_, i) => `c${i}`).join(' ')}) z`),
    })
    const lines = () => el.querySelectorAll('.term-line').length
    const folded = () => el.querySelectorAll('.term-fold').length
    const auto = lines()
    expect(folded(), 'the policy folds the subterm over AUTO_FOLD_NODES').toBe(1)
    el.querySelector<HTMLElement>('.term-fold')?.click()
    expect(folded(), 'opened by hand').toBe(0)
    expect(lines()).toBeGreaterThan(auto)
    el.querySelector<HTMLElement>('.term-gutter[data-node="0"]')?.click()
    expect(lines(), 'the root folded by hand').toBe(1)
    el.querySelector<HTMLButtonElement>('button.reset-folds')?.click()
    expect(lines()).toBe(auto)
    expect(folded(), 'folded again by the policy').toBe(1)
  })
})

describe('a λ view’s folds across bindings', () => {
  /**
   * A NEW BINDING STARTS FROM THE AUTOMATIC FOLDS. Folds are keyed by path, and a path in one session's term
   * names nothing in another's — the prototype carried a copy's folds home onto the program's tree, and no
   * app-level test noticed. `setBindings` runs every frame, so the same binding must keep them.
   */
  it('keeps its folds while bound to one session, and starts another from the automatic policy', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    const bind = (session: string) => pane.setBindings([option('source'), option('copy')], { leg: 'lambda', session })
    bind('source')
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    const lines = () => el.querySelectorAll('.term-line').length
    const open = lines()
    expect(open).toBeGreaterThan(1)
    el.querySelector<HTMLElement>('.term-gutter[data-node="0"]')?.click()
    expect(lines()).toBe(1)

    bind('source')
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    expect(lines(), 'the same binding, one frame later').toBe(1)

    bind('copy')
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    expect(lines(), 'another session’s term').toBe(open)
  })

  it('keeps its folds through one build, and starts a new build of the same session from the automatic policy', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.setBuild(1)
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    const lines = () => el.querySelectorAll('.term-line').length
    const open = lines()
    el.querySelector<HTMLElement>('.term-gutter[data-node="0"]')?.click()
    expect(lines()).toBe(1)

    pane.setBuild(1)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    expect(lines(), 'the same build, one frame later').toBe(1)

    pane.setBuild(2)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    expect(lines(), 'a new build').toBe(open)
  })
})

/**
 * A TREE THE VIEW CANNOT LAY OUT LEAVES A WORKING VIEW AND ONE NOTE (spec §10). The view stores a tree before
 * laying it out, so a layout that threw left that tree in place, and every later frame threw on it again: the
 * view never drew another, even after a recompile. The wire here has no names to read, so any layout of it
 * throws, whatever the layouts' own depth limits are.
 *
 * **THE ERROR IS LOGGED ONCE.** The layouts cannot overflow now, so anything this catches is a bug, and it
 * goes to the console — once per tree, which is also what shows the tree is not tried again every frame.
 */
describe('a λ view whose tree cannot be laid out', () => {
  it('shows the frame’s text with one note, answers every later frame, and draws the next tree', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    const unreadable = { ...wireOf('\\x. \\y. x'), names: undefined as unknown as string[] }
    const term = () => el.querySelector<HTMLElement>('.term')
    const notes = () => [...el.querySelectorAll('.term-note')].map((n) => n.textContent)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    onTestFinished(() => logged.mockRestore())
    pane.render(frame, CONTROLS)
    expect(() => pane.renderTree({ kind: 'tree', tree: unreadable })).not.toThrow()
    expect(term()?.dataset.layout).toBe('flat')
    expect(term()?.textContent).toContain('λx. λy. x')
    expect(notes()).toEqual(['this step’s term could not be laid out — shown as text'])
    expect(pane.linkState()).toBe('too-large')

    // THE FRAMES AFTER IT: `draw()` renders the view, then hands it the same tree again.
    expect(() => pane.render(frame, CONTROLS)).not.toThrow()
    expect(() => pane.renderTree({ kind: 'tree', tree: unreadable })).not.toThrow()
    expect(() => pane.render(frame, CONTROLS)).not.toThrow()
    expect(notes()).toHaveLength(1)
    expect(logged, 'logged once, and not tried again on the frames after').toHaveBeenCalledTimes(1)

    pane.renderTree({ kind: 'tree', tree: wireOf('\\x. \\y. x') })
    expect(term()?.dataset.layout).toBe('code')
    expect(term()?.textContent).toBe('λx y. x')
    expect(notes()).toEqual([])
    expect(pane.linkState()).toBe('shown')
  })
})
