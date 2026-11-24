import { afterEach, describe, expect, it } from 'vitest'
import type { Dir } from '../../src/layout'
import type { PaneChoice, SplitChoices } from '../../src/pane-chrome'
import { bindingKey, viewMenu } from '../../src/view-header'
import { moreOf } from './harness'

const CHOICES: SplitChoices = {
  options: [
    { leg: 'lambda', id: 'source', label: 'program' },
    { leg: 'tm', id: 'source', label: 'program' },
    { leg: 'rxm', id: 'source', label: 'program' },
  ],
  sourceAvailable: true,
  current: { leg: 'lambda', session: 'source' },
}

afterEach(() => {
  document.body.replaceChildren()
})

const build = (over: Partial<Parameters<typeof viewMenu>[1]> = {}, { formats = true } = {}) => {
  const actions = document.createElement('div')
  document.body.append(actions)
  const log: string[] = []
  const menu = viewMenu(actions, {
    split: (dir: Dir, c: PaneChoice) =>
      log.push(`split ${dir} ${c.kind === 'source' ? 'source' : bindingKey(c.kind, c.session)}`),
    close: () => log.push('close'),
    ...(formats ? { format: () => log.push('format') } : {}),
    choices: () => CHOICES,
    ...over,
  })
  return { actions, menu, log }
}

const items = (a: HTMLElement) =>
  [...a.querySelectorAll<HTMLButtonElement>('.view-menu-main button')].map(
    (b) => b.querySelector('.view-menu-label')?.textContent,
  )

describe('the view menu', () => {
  it('offers only what applies, and no ⋯ at all when nothing does', () => {
    const { actions, menu } = build({}, { formats: false })
    menu.setLayout(false, false)
    expect(moreOf(actions)).toBeNull()
    expect(actions.querySelector('button.view-close')).toBeNull()
    menu.setLayout(true, true)
    expect(items(actions)).toEqual(['split right', 'split down'])
    expect(actions.querySelector('button.view-close')?.getAttribute('aria-label')).toBe('close this view')
    // AND BACK TO NOTHING — the first assertion above cannot fail on its own: every setter returns early
    // on the state it already holds, so a menu that has never had an item has never been synced at all.
    menu.setLayout(false, false)
    expect(moreOf(actions)).toBeNull()
    expect(actions.querySelector('button.view-close')).toBeNull()
  })

  it('offers format from the start on a view that formats, before any of its other state changes', () => {
    const { actions } = build()
    expect(moreOf(actions), 'no ⋯ to reach format by').not.toBeNull()
    expect(items(actions)).toEqual(['format'])
  })

  it('names ⋯ and ✕ in words, and states ⋯ opens a menu', () => {
    const { actions, menu } = build()
    menu.setLayout(true, true)
    expect(moreOf(actions)?.getAttribute('aria-label')).toBe('view actions')
    expect(moreOf(actions)?.getAttribute('aria-haspopup')).toBe('menu')
    expect(moreOf(actions)?.getAttribute('aria-expanded')).toBe('false')
  })

  it('asks which view to split into, the view itself first as "another view of this"', () => {
    const { actions, menu, log } = build()
    menu.setLayout(true, true)
    moreOf(actions)?.click()
    actions.querySelector<HTMLButtonElement>('button.view-split[data-dir="row"]')?.click()
    const pairs = [...actions.querySelectorAll<HTMLButtonElement>('.view-menu-pairs button')]
    expect(pairs.map((b) => b.textContent)).toEqual(['another view of this', 'TM · program', 'rxm · program', 'source'])
    expect(document.activeElement).toBe(pairs[0])
    pairs[1]?.click()
    expect(log).toEqual([`split row ${bindingKey('tm', 'source')}`])
    expect(actions.querySelector('.view-menu-pairs')?.children.length).toBe(0)
  })

  /**
   * **THE NEGATIVE DIRECTION OF `sourceAvailable`.** The split submenu offers *source* only when the
   * tree has no source leaf; `CHOICES` hardcodes `sourceAvailable: true`, so the test above pins only
   * the positive. A source view offered twice is a tree with two source leaves, which `splitLeaf`
   * assumes cannot happen.
   */
  it('does not offer source to split into when the tree already has one', () => {
    const { actions, menu } = build({ choices: () => ({ ...CHOICES, sourceAvailable: false }) })
    menu.setLayout(true, true)
    moreOf(actions)?.click()
    actions.querySelector<HTMLButtonElement>('button.view-split[data-dir="row"]')?.click()
    const pairs = [...actions.querySelectorAll<HTMLButtonElement>('.view-menu-pairs button')]
    expect(pairs.map((b) => b.textContent)).toEqual(['another view of this', 'TM · program', 'rxm · program'])
    expect(actions.querySelector('.view-menu-pairs button[data-source]')).toBeNull()
  })

  it('runs each item, closing the menu first', () => {
    const { actions, menu, log } = build()
    menu.setLayout(true, true)
    moreOf(actions)?.click()
    actions.querySelector<HTMLButtonElement>('button.format-doc')?.click()
    expect(actions.querySelector('.view-menu')?.matches(':popover-open')).toBe(false)
    actions.querySelector<HTMLButtonElement>('button.view-close')?.click()
    expect(log).toEqual(['format', 'close'])
  })
})

/**
 * **WHERE THE VIEW MENU OPENS** — an unanchored popover would open at the viewport origin, far from the
 * control that opened it.
 *
 * THESE ARE REAL MEASUREMENTS, NOT A PROXY FOR ONE. `tests/browser/setup.ts` loads `style.css` into the
 * tester page, so `getBoundingClientRect` here reads the rules the app ships rather than UA defaults.
 *
 * THE FIXTURE POSITIONS THE ACTIONS AWAY FROM THE ORIGIN, which is the whole point: at `left: 0; top: 0` a
 * correctly-anchored menu and a viewport-pinned one would sit in the same place and the assertion would
 * pass for the wrong reason.
 */
const rect = (el: Element | null | undefined) => (el ?? document.body).getBoundingClientRect()
const menuAt = (x: number, y: number): HTMLElement => {
  const { actions, menu } = build()
  actions.style.position = 'absolute'
  actions.style.left = `${x}px`
  actions.style.top = `${y}px`
  menu.setLayout(true, true)
  return actions
}

describe('where the view menu opens', () => {
  it('opens against the button that opened it, not at the viewport origin', () => {
    const actions = menuAt(200, 150)
    const b = moreOf(actions)
    b?.click()
    const menu = rect(actions.querySelector('.view-menu'))
    const button = rect(b)

    // Directly below its own button, and sharing its TRAILING edge — `span-inline-start` opens the menu
    // leftward from `⋯`, which sits at a view's right edge.
    expect(menu.top).toBeGreaterThanOrEqual(button.bottom - 1)
    expect(Math.abs(menu.right - button.right)).toBeLessThan(2)
    // Which is nowhere near the corner an unanchored menu would pin itself to.
    expect(menu.right).toBeGreaterThan(100)
    expect(menu.top).toBeGreaterThan(100)
  })

  it('gives each view menu its own place, since each anchors to its own button', () => {
    // INSIDE THE TESTER PAGE, which is 414px wide: a fixture past its right edge measures the page, not
    // the menu.
    const left = menuAt(200, 150)
    const right = menuAt(330, 150)

    moreOf(left)?.click()
    const leftMenu = rect(left.querySelector('.view-menu'))
    left.querySelector<HTMLElement>('.view-menu')?.hidePopover()

    moreOf(right)?.click()
    const rightMenu = rect(right.querySelector('.view-menu'))

    const sharesEdge = (menu: DOMRect, button: DOMRect) =>
      Math.abs(menu.left - button.left) < 2 || Math.abs(menu.right - button.right) < 2
    expect(sharesEdge(leftMenu, rect(moreOf(left)))).toBe(true)
    expect(sharesEdge(rightMenu, rect(moreOf(right)))).toBe(true)
    // Two controls, two places — the failure a shared anchor would produce.
    expect(Math.abs(rightMenu.left - leftMenu.left)).toBeGreaterThan(2)
    // And both on screen, which is what the fallbacks are for.
    expect(rightMenu.left).toBeGreaterThanOrEqual(0)
    expect(rightMenu.right).toBeLessThanOrEqual(window.innerWidth)
  })

  it('flips above the button rather than off-screen at the viewport bottom edge', () => {
    const actions = menuAt(200, window.innerHeight - 30)
    const b = moreOf(actions)
    b?.click()
    const menu = rect(actions.querySelector('.view-menu'))

    expect(menu.bottom).toBeLessThanOrEqual(rect(b).top + 1)
    expect(menu.top).toBeGreaterThanOrEqual(0)
    expect(menu.bottom).toBeLessThanOrEqual(window.innerHeight)
    // STILL ITS OWN BUTTON'S MENU AFTER THE FLIP, and this line is what stops the test passing vacuously:
    // an unanchored menu would already be ABOVE a button sitting near the bottom of the window — it would
    // be above everything, at the origin — so only the shared edge tells the two apart.
    expect(Math.abs(menu.right - rect(b).right)).toBeLessThan(2)
  })
})
