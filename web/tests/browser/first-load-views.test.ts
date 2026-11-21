import { beforeAll, describe, expect, it } from 'vitest'
import { cdp, userEvent } from 'vitest/browser'
import { KIND_GLOSS } from '../../src/app-header'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { chromiumOnly } from './engine'
import { box, mountAt, mounted, pressed, storedLayout, token, until } from './harness'

/**
 * WHAT A FIRST VISIT SHOWS — the view layouts spec §8: the source beside the TM view, the focus on the TM view, and
 * the two `views` toggles pressed.
 *
 * `setup.ts` stores a four-view workspace for every file, as a returning visitor's would be, so that the files written
 * against four views keep starting on them. This file removes the stored workspace before its mount, and so mounts
 * the page a visitor gets.
 */

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.removeItem(LAYOUT_STORAGE_KEY)

describe('a first load, in a window wider than it is tall', () => {
  beforeAll(async () => {
    // WIDER THAN TALL, SO THE PAIR IS A ROW: at the runner's default 414 × 896 the views area is taller than it is
    // wide and the same first load is a column (`first-load-views-tall.test.ts`).
    await mountAt(1280, 896)
  })

  it('starts from nothing stored: the precondition every case below rests on', () => {
    // WRITTEN BY THE MOUNT, NOT FOUND BY IT: the app stores the workspace it opened on.
    expect(storedLayout().tree, 'the stored tree is not the first-load tree').toEqual({
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [
        { kind: 'leaf', id: 'source', pane: 'source' },
        { kind: 'leaf', id: 'tm-0', pane: 'tm' },
      ],
    })
  })

  it('shows the source and the TM view and no other', () => {
    expect(mounted()).toEqual(['source', 'tm-0'])
    expect(document.querySelector('[data-leaf="lambda-0"]'), 'a λ view is on the page').toBeNull()
    expect(document.querySelector('[data-leaf="rxm-0"]'), 'an rxm view is on the page').toBeNull()
  })

  it('puts them side by side, a half each', () => {
    const source = box('source')
    const tm = box('tm-0')
    expect(source.width, 'the source view has no width').toBeGreaterThan(160)
    expect(Math.abs(source.top - tm.top), 'the two views do not share a top edge').toBeLessThan(1)
    expect(source.right, 'the TM view does not start where the source view ends').toBeLessThanOrEqual(tm.left)
    expect(Math.abs(source.width - tm.width), 'the two views are not a half each').toBeLessThan(1)
    expect(Math.abs(source.height - tm.height)).toBeLessThan(1)
  })

  it('presses the source and TM toggles and leaves λ, rxm and CLIF unpressed', () => {
    expect(pressed()).toEqual(['source', 'tm'])
    const all = [...document.querySelectorAll<HTMLButtonElement>('#views-shown button')]
    expect(all.map((b) => b.textContent)).toEqual(['source', 'λ', 'TM', 'rxm', 'CLIF'])
    expect(all.map((b) => b.title)).toEqual([
      'hide the source view',
      'show the λ view',
      'hide the TM view',
      `show the rxm view\n${KIND_GLOSS.rxm}`,
      `show the CLIF view\n${KIND_GLOSS.clif}`,
    ])
    // `aria-disabled` IS HOW A TOGGLE IS DISABLED (`app-header.ts`'s `viewToggles`): the `disabled` property is
    // false of every toggle whatever the page shows.
    expect(all.map((b) => b.getAttribute('aria-disabled'))).toEqual([null, null, null, null, null])
  })

  /**
   * **WHERE THE TOGGLES ARE DRAWN, AND NOT THE ORDER THE MARKUP LISTS THEM IN**: a stylesheet can lay a row out in
   * another order than its document's, and the order a reader goes by is the one across the header.
   */
  it('draws the toggles left to right as source, λ, TM, rxm and CLIF, on one line', () => {
    const onScreen = [...document.querySelectorAll<HTMLButtonElement>('#views-shown button')]
      .map((b) => ({ word: b.textContent, box: b.getBoundingClientRect() }))
      .sort((a, b) => a.box.left - b.box.left)
    expect(onScreen.map((toggle) => toggle.word)).toEqual(['source', 'λ', 'TM', 'rxm', 'CLIF'])
    for (const [i, { word, box }] of onScreen.entries()) {
      expect(box.width, `the ${word} toggle has no width`).toBeGreaterThan(0)
      const before = onScreen[i - 1]
      if (before === undefined) continue
      expect(box.left, `the ${word} toggle starts inside the ${before.word} toggle`).toBeGreaterThanOrEqual(
        before.box.right,
      )
      expect(
        Math.abs(box.top - before.box.top),
        `the ${word} toggle left the ${before.word} toggle’s line`,
      ).toBeLessThan(1)
    }
  })

  /**
   * **THE TOGGLES' LOOK** (the view switcher style design): five buttons apart, each with a solid edge, a pressed one
   * edged and underlined in `--accent` and one that is not edged in `--rule`. The underline is an inset shadow along
   * the foot, the cue that is not a colour. Each part is a case of its own, so each taken out of `style.css` fails on
   * its own. Their corners differ by style, so `view-toggle-focus-ring.test.ts` reads those, in every style: a style
   * chosen here would make this something other than the page a visitor gets.
   *
   * **A COLOUR OR A RADIUS IS READ AS THE PAGE RESOLVES ITS TOKEN** (the harness's `token`), so the case holds the
   * token and not one palette's or one style's value of it.
   */
  const toggles = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('#views-shown button')]
  /** Each side's style and colour, the colour by its name in `names` where it has one; four alike are one entry. */
  const edges = (b: HTMLButtonElement, names: Record<string, string>): string[] => {
    const style = getComputedStyle(b)
    const each = ['top', 'right', 'bottom', 'left'].map((side) => {
      const colour = style.getPropertyValue(`border-${side}-color`)
      return `${style.getPropertyValue(`border-${side}-style`)} ${names[colour] ?? colour}`
    })
    return [...new Set(each)]
  }

  it('edges every side of a pressed toggle solid in the accent, and of one that is not solid in the rule', () => {
    const [accent, rule] = [token('--accent'), token('--rule')]
    expect(accent, 'precondition: the accent and the rule resolve apart').not.toBe(rule)
    const names = { [accent]: 'accent', [rule]: 'rule' }
    expect(toggles().map((b) => [b.dataset.shows, b.getAttribute('aria-pressed'), edges(b, names)])).toEqual([
      ['source', 'true', ['solid accent']],
      ['lambda', 'false', ['solid rule']],
      ['tm', 'true', ['solid accent']],
      ['rxm', 'false', ['solid rule']],
      ['clif', 'false', ['solid rule']],
    ])
  })

  it('underlines a pressed toggle in the accent, inside its box, and not one that is not', () => {
    const accent = token('--accent')
    expect(toggles().map((b) => [b.dataset.shows, getComputedStyle(b).boxShadow])).toEqual([
      ['source', `${accent} 0px -2px 0px 0px inset`],
      ['lambda', 'none'],
      ['tm', `${accent} 0px -2px 0px 0px inset`],
      ['rxm', 'none'],
      ['clif', 'none'],
    ])
  })

  it('sets the toggles apart, a gap between each and the next', () => {
    const boxes = toggles().map((b) => b.getBoundingClientRect())
    expect(boxes, 'precondition: the five').toHaveLength(5)
    const gaps = boxes.slice(1).map((b, i) => b.left - (boxes[i] as DOMRect).right)
    for (const [i, gap] of gaps.entries()) expect.soft(gap, `the gap after toggle ${i + 1}`).toBeGreaterThan(0)
  })

  /**
   * **FORCED COLOURS TAKE EVERY CUE ABOVE AWAY**: they put a system colour in place of each of the page's and draw no
   * shadow, so the five would be alike. What they leave is a border's style and a system colour the page names, so
   * there one that is not pressed is dashed and a pressed one is edged in `Highlight`.
   */
  it('tells a pressed toggle from one that is not in forced colours, solid in Highlight against dashed', async (ctx) => {
    chromiumOnly(ctx, 'forced colours are CDP’s Emulation.setEmulatedMedia, which only Chromium has')
    // **THE POINTER STAYS WHERE THE FILE BEFORE THIS ONE LEFT IT**, and forced colours edge a button under it in
    // `Highlight`, so the edges read below are the resting ones only once it is off every button they name.
    const read = [...toggles(), document.querySelector('#new-view') as HTMLElement]
    await userEvent.unhover(read[0] as HTMLElement)
    await until(() => !read.some((b) => b.matches(':hover')), 'the pointer off the toggles and + view')
    await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] })
    try {
      expect(matchMedia('(forced-colors: active)').matches, 'precondition: forced colours').toBe(true)
      expect(getComputedStyle(toggles()[0] as HTMLButtonElement).boxShadow, 'precondition: no underline').toBe('none')
      const highlight = token('Highlight')
      const button = getComputedStyle(document.querySelector('#new-view') as HTMLElement).borderTopColor
      expect(highlight, 'precondition: Highlight is not the edge forced colours give a header button').not.toBe(button)
      const names = { [highlight]: 'Highlight', [button]: 'a button’s' }
      expect(toggles().map((b) => [b.dataset.shows, b.getAttribute('aria-pressed'), edges(b, names)])).toEqual([
        ['source', 'true', ['solid Highlight']],
        ['lambda', 'false', ['dashed a button’s']],
        ['tm', 'true', ['solid Highlight']],
        ['rxm', 'false', ['dashed a button’s']],
        ['clif', 'false', ['dashed a button’s']],
      ])
    } finally {
      await cdp().send('Emulation.setEmulatedMedia', { features: [] })
    }
  })

  it('records the TM view as the focused one, and remembers no other arrangement', () => {
    expect(storedLayout().focused).toBe('tm-0')
    expect('arrangements' in storedLayout(), 'a fresh page stored an arrangements field').toBe(false)
  })

  /**
   * **THE FOCUS ON THE TM VIEW IS THE WORKSPACE'S RECORD, AND THIS IS WHAT IT DOES ON THE PAGE.** A load takes no
   * keyboard focus (`document.activeElement` is `<body>` here) and the app marks no view as the focused one, so the
   * record is seen where it is used: `+ view` adds beside the focused view. Beside the source it would add between the
   * two. Last in the file, since it changes the views.
   */
  it('adds the next view beside the TM view, which is where the focus is', async () => {
    expect(document.activeElement, 'precondition: the load took no keyboard focus').toBe(document.body)
    document.querySelector<HTMLButtonElement>('#new-view')?.click()
    const item = [...document.querySelectorAll<HTMLButtonElement>('#new-view-menu button')].find(
      (b) => b.textContent === 'λ · program',
    )
    if (item === undefined) throw new Error('+ view offers no λ · program')
    item.click()
    await until(() => mounted().length === 3, 'the view + view adds')
    expect(mounted()).toEqual(['source', 'tm-0', 'pane-1'])
  })
})
