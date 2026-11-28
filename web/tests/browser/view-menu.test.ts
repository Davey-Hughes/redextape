import { afterEach, describe, expect, it } from 'vitest'
import type { Dir, MoveDirection } from '../../src/layout'
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

const build = (over: Partial<Parameters<typeof viewMenu>[1]> = {}, { formats = true, splits = true } = {}) => {
  const actions = document.createElement('div')
  document.body.append(actions)
  const log: string[] = []
  const menu = viewMenu(actions, {
    ...(splits
      ? {
          split: (dir: Dir, c: PaneChoice) =>
            log.push(`split ${dir} ${c.kind === 'source' ? 'source' : bindingKey(c.kind, c.session)}`),
          choices: () => CHOICES,
        }
      : {}),
    close: () => log.push('close'),
    ...(formats ? { format: () => log.push('format') } : {}),
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
 * **THE FOUR MOVE ITEMS** (the view layouts spec §9.1, §9.3, §9.4): after the splits, in tiles only, each disabled
 * with its reason while it cannot be taken, and asked so when the menu opens rather than when it was built.
 */
describe('the view menu’s move items', () => {
  const moving = (refused: Partial<Record<MoveDirection, string>>) => {
    const asked = { ...refused }
    const built = build({
      move: {
        go: (d: MoveDirection) => built.log.push(`move ${d}`),
        refusal: (d: MoveDirection) => asked[d] ?? null,
      },
    })
    return { ...built, asked }
  }
  const moveItem = (a: HTMLElement, d: MoveDirection) =>
    a.querySelector<HTMLButtonElement>(`button.view-move[data-direction="${d}"]`)

  it('lists the four after the splits in tiles, and none where the views are not tiled', () => {
    const { actions, menu } = moving({})
    menu.setLayout(true, true)
    expect(items(actions)).toEqual([
      'split right',
      'split down',
      'move view left',
      'move view right',
      'move view up',
      'move view down',
      'format',
    ])
    menu.setLayout(true, false)
    expect(items(actions)).toEqual(['format'])
  })

  it('offers them on a view with no split, as the source view is', () => {
    const { actions, menu } = build({ move: { go: () => {}, refusal: () => null } }, { splits: false })
    menu.setLayout(true, true)
    expect(items(actions)).toEqual(['move view left', 'move view right', 'move view up', 'move view down', 'format'])
  })

  it('disables a refused move with its reason when the menu opens, and enables it again when it can be taken', () => {
    const { actions, menu, asked } = moving({ right: 'this view is as far right as it can go' })
    menu.setLayout(true, true)
    moreOf(actions)?.click()
    const right = moveItem(actions, 'right')
    expect(right?.disabled).toBe(true)
    expect(right?.getAttribute('aria-description')).toBe('this view is as far right as it can go')
    expect(right?.title).toBe('this view is as far right as it can go')
    expect(moveItem(actions, 'left')?.disabled).toBe(false)
    expect(moveItem(actions, 'left')?.hasAttribute('aria-description')).toBe(false)
    // ASKED AGAIN AT THE NEXT OPEN: another view's gesture changes what this one can do.
    ;(actions.querySelector('.view-menu') as HTMLElement).hidePopover()
    delete asked.right
    moreOf(actions)?.click()
    expect(right?.disabled).toBe(false)
    expect(right?.hasAttribute('aria-description')).toBe(false)
    expect(right?.hasAttribute('title')).toBe(false)
  })

  it('opens on the first move it can take where no split comes before it', () => {
    const { actions, menu } = build(
      { move: { go: () => {}, refusal: (d) => (d === 'left' ? 'no' : null) } },
      { splits: false },
    )
    menu.setLayout(true, true)
    moreOf(actions)?.click()
    expect(document.activeElement).toBe(moveItem(actions, 'right'))
  })

  it('closes the menu, then moves', () => {
    const { actions, menu, log } = moving({})
    menu.setLayout(true, true)
    moreOf(actions)?.click()
    moveItem(actions, 'down')?.click()
    expect(actions.querySelector('.view-menu')?.matches(':popover-open')).toBe(false)
    expect(log).toEqual(['move down'])
  })
})

/**
 * **ONE COLUMN OF LABELS IN EVERY VIEW'S MENU**: an item with no glyph keeps the glyph's place, so its label starts where
 * *format*'s does after its `≡`, whatever builds the item. Measured on the stylesheet the app ships, as below.
 */
describe('the view menu’s labels', () => {
  /** Where `b`'s label starts, from its menu's left edge: its label's, or the text's of an item that is text alone. */
  const labelAt = (b: HTMLButtonElement): number => {
    const range = document.createRange()
    range.selectNodeContents(b.querySelector('.view-menu-label') ?? b)
    return Math.round(range.getBoundingClientRect().left - rect(b.closest('.view-menu')).left)
  }
  const labels = (a: HTMLElement, list: string) =>
    [...a.querySelectorAll<HTMLButtonElement>(`${list} button`)].map((b) => ({ item: b.textContent, at: labelAt(b) }))
  /** Where *format*'s label starts, after its glyph, in a menu that has nothing else. */
  const formatAt = (): number => {
    const { actions } = build({}, { splits: false })
    moreOf(actions)?.click()
    const format = actions.querySelector<HTMLButtonElement>('button.format-doc') as HTMLButtonElement
    expect(format.querySelector('.icon'), 'precondition: format has its glyph').not.toBeNull()
    const at = labelAt(format)
    actions.remove()
    return at
  }
  const move = { go: () => {}, refusal: () => null }

  it('starts every label of the source view’s menu where format’s starts', () => {
    const column = formatAt()
    const { actions, menu } = build({ move }, { splits: false })
    menu.setLayout(true, true)
    moreOf(actions)?.click()
    const drawn = labels(actions, '.view-menu-main')
    expect(drawn.map((d) => d.item)).toEqual([
      'move view left',
      'move view right',
      'move view up',
      'move view down',
      'format',
    ])
    expect(drawn).toEqual(drawn.map((d) => ({ ...d, at: column })))
  })

  it('starts every label of a pane’s menu there too: its settings, its checks and the views a split offers', () => {
    const column = formatAt()
    const on = { on: () => false, set: () => {} }
    const { actions, menu } = build(
      {
        move,
        display: {
          groups: [
            {
              label: 'layout',
              choices: [
                { value: 'code', label: 'code' },
                { value: 'outline', label: 'outline' },
              ],
              current: () => 'code',
              pick: () => {},
            },
          ],
          expandAll: on,
          reset: () => {},
        },
      },
      { formats: false },
    )
    menu.setLayout(true, true)
    menu.addCheck('clif-compact', 'compact', on)
    moreOf(actions)?.click()
    const drawn = labels(actions, '.view-menu-main')
    expect(drawn.map((d) => d.item)).toEqual([
      'split right',
      'split down',
      'move view left',
      'move view right',
      'move view up',
      'move view down',
      'code',
      'outline',
      'expand all',
      'reset folds',
      'compact',
    ])
    expect(drawn).toEqual(drawn.map((d) => ({ ...d, at: column })))
    actions.querySelector<HTMLButtonElement>('button.view-split[data-dir="row"]')?.click()
    const pairs = labels(actions, '.view-menu-pairs')
    expect(pairs.length, 'precondition: the split offers its views').toBeGreaterThan(0)
    expect(pairs).toEqual(pairs.map((d) => ({ ...d, at: column })))
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
