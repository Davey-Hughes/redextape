import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { box, mountAt, mounted, pressed, storedLayout, until } from './harness'

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
    expect(document.querySelector('[data-leaf="asm-0"]'), 'an asm view is on the page').toBeNull()
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

  it('presses the source and TM toggles and leaves λ and asm unpressed', () => {
    expect(pressed()).toEqual(['source', 'tm'])
    const all = [...document.querySelectorAll<HTMLButtonElement>('#views-shown button')]
    expect(all.map((b) => b.textContent)).toEqual(['source', 'asm', 'λ', 'TM'])
    expect(all.map((b) => b.title)).toEqual([
      'hide the source view',
      'show the asm view',
      'show the λ view',
      'hide the TM view',
    ])
    // `aria-disabled` IS HOW A TOGGLE IS DISABLED (`app-header.ts`'s `viewToggles`): the `disabled` property is
    // false of every toggle whatever the page shows.
    expect(all.map((b) => b.getAttribute('aria-disabled'))).toEqual([null, null, null, null])
  })

  /**
   * **A PRESSED TOGGLE DIFFERS FROM ONE THAT IS NOT BY MORE THAN ITS COLOURS** (spec §6): its border is solid where
   * the other's is dashed, and it is underlined, by an inset shadow along its foot. Each is read apart, so either one
   * taken out of `style.css` fails.
   */
  it('draws a pressed toggle solid and underlined, and one that is not dashed with no underline', () => {
    const look = (b: HTMLButtonElement): { border: string; underlined: boolean } => {
      const style = getComputedStyle(b)
      return { border: style.borderTopStyle, underlined: style.boxShadow.includes('0px -2px 0px 0px inset') }
    }
    const all = [...document.querySelectorAll<HTMLButtonElement>('#views-shown button')]
    expect(all.map((b) => [b.dataset.shows, b.getAttribute('aria-pressed'), look(b)])).toEqual([
      ['source', 'true', { border: 'solid', underlined: true }],
      ['asm', 'false', { border: 'dashed', underlined: false }],
      ['lambda', 'false', { border: 'dashed', underlined: false }],
      ['tm', 'true', { border: 'solid', underlined: true }],
    ])
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
