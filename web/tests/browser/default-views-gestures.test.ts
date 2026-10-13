import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { parseWorkspace } from '../../src/workspace'
import { drawn, resetToFirstLoad, SHELL, showWideDefault, until } from './harness'

/**
 * THE GESTURES THAT DEPEND ON A TREE'S SHAPE, ON THE TWO TREES A VISITOR IS GIVEN — the view layouts spec §4.4 and
 * §8: the source beside the TM view, which a first load and *reset preset* build, and all four views in two columns,
 * which is where the toggles lead from there in a wide window.
 *
 * **`setup.ts` STORES ALL FOUR VIEWS IN TWO ROWS FOR EVERY FILE, AND NO DEFAULT BUILDS THAT TREE IN A WIDE WINDOW.**
 * What a `✕` does depends on which view is its neighbour, and what a view key does on which view is first in the tree
 * it shows; the files written against the two rows hold both for a tree nobody is given. A source view that lost its
 * scroll position to the focus a `✕` gave it went unseen there, the source view being the neighbour of no view those
 * files close (`focus-scroll.test.ts`).
 *
 * **EACH GESTURE IS HELD TO FOUR THINGS**: the tree it leaves, by `drawn`; the view the focus is in, which is never
 * `<body>`; that a view whose box the gesture did not change is scrolled where it was; and that the stored workspace
 * passes `parseWorkspace`.
 *
 * **A VIEW WHOSE BOX CHANGED IS HELD ONLY WHERE IT TOOK THE FOCUS**, to as much of its scroll as its new box has
 * room for. A view whose tile grows can lose a scroll position with nothing taking it: there is less to scroll.
 */

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.removeItem(LAYOUT_STORAGE_KEY)

const PROGRAM = `let x = 40;${'\n'.repeat(60)}x + 2`
const PREFIX = '{Control>}.{/Control}'

let view: EditorView

const host = (leaf: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${leaf}"]:not([role="tab"])`) as HTMLElement
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const idle = (): boolean => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const range = (el: HTMLElement): number => el.scrollHeight - el.clientHeight
const first = (leaf: string): HTMLElement => host(leaf).querySelector('button') as HTMLElement
const frames = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
const stored = (): string | null => localStorage.getItem(LAYOUT_STORAGE_KEY)
/** The view the focus is in, by its leaf: `undefined` for a focus on the header, a divider or `<body>`. */
const viewOfFocus = (): string | undefined =>
  document.activeElement?.closest<HTMLElement>('#views [data-leaf]:not([role="tab"])')?.dataset.leaf

/** A place in each view that takes the focus when it is pressed and opens nothing. */
const INSIDE: Readonly<Record<string, string>> = {
  source: '.cm-line',
  'asm-0': '.asm-listing',
  'lambda-0': '.term',
  'tm-0': '.state-table',
}

type Held = ReadonlyMap<string, { top: number; width: number; height: number }>
/** Scroll every view that can be scrolled 40 px to 40 px, and answer where each view is and how big. */
async function arm(): Promise<Held> {
  for (const leaf of mounted()) if (range(host(leaf)) >= 40) host(leaf).scrollTop = 40
  await frames()
  return new Map(
    mounted().map((leaf) => {
      const el = host(leaf)
      return [leaf, { top: el.scrollTop, width: el.clientWidth, height: el.clientHeight }]
    }),
  )
}

/**
 * What every gesture here is held to once it has run: `tree` on the page, the focus in `focused` two frames on, the
 * scroll positions `before` recorded (this file's doc has which), and a stored workspace that parses. `byKey` is the
 * view a key gave the focus to, whose first control has to be in sight instead (`focus-scroll.test.ts`).
 */
async function settled(what: string, tree: string, focused: string, before: Held, byKey?: string): Promise<void> {
  expect(drawn(), `${what}: the tree`).toBe(tree)
  await frames()
  expect(viewOfFocus(), `${what}: the view the focus is in`).toBe(focused)
  for (const leaf of mounted()) {
    const was = before.get(leaf)
    const el = host(leaf)
    if (was === undefined) continue
    if (leaf === byKey) {
      const [box, control] = [el.getBoundingClientRect(), first(leaf).getBoundingClientRect()]
      expect(
        control.top >= box.top - 0.5 && control.bottom <= box.top + el.clientHeight + 0.5,
        `${what}: the ${leaf} view’s first control is out of sight`,
      ).toBe(true)
    } else if (was.width === el.clientWidth && was.height === el.clientHeight) {
      expect(el.scrollTop, `${what}: the ${leaf} view, whose box did not change`).toBe(was.top)
    } else if (leaf === focused) {
      expect(el.scrollTop, `${what}: the ${leaf} view, which took the focus`).toBe(Math.min(was.top, range(el)))
    }
  }
  expect(parseWorkspace(stored()), `${what}: the stored workspace does not parse`).not.toBeNull()
}

/** The first view of `tree` that is not the source, or the source: where the focus goes when its view is hidden. */
const firstView = (tree: string): string => {
  const ids = tree.match(/[a-z]+(-\d+)?(?=[ )]|$)/g) ?? []
  return ids.find((id) => id !== 'source') ?? 'source'
}

type Layout = {
  readonly name: string
  readonly make: () => Promise<void>
  readonly views: readonly string[]
  /** For each view, the tree its `✕` leaves and the view that takes the focus. */
  readonly closed: Readonly<Record<string, readonly [tree: string, focused: string]>>
  /** For each view key, the tree it leaves. */
  readonly keyed: Readonly<Record<string, string>>
  /** For each divider, by its path, the views on its two sides. */
  readonly dividers: Readonly<Record<string, readonly string[]>>
}

const FIRST_LOAD: Layout = {
  name: 'the source beside the TM view',
  make: resetToFirstLoad,
  views: ['source', 'tm-0'],
  closed: {
    source: ['tm-0', 'tm-0'],
    'tm-0': ['source', 'source'],
  },
  keyed: {
    '1': 'tm-0',
    '2': 'row[50](source column[50](asm-0 tm-0))',
    '3': 'row[50](source column[50](lambda-0 tm-0))',
    '4': 'source',
    ']': 'row[50](column[50](source asm-0) column[50](lambda-0 tm-0))',
    '[[': 'row[50](source lambda-0)',
  },
  dividers: { '[]': ['source', 'tm-0'] },
}

const WIDE_FOUR: Layout = {
  name: 'all four views in two columns',
  make: showWideDefault,
  views: ['source', 'asm-0', 'lambda-0', 'tm-0'],
  closed: {
    source: ['row[50](asm-0 column[50](lambda-0 tm-0))', 'asm-0'],
    'asm-0': ['row[50](source column[50](lambda-0 tm-0))', 'source'],
    // THE VIEW BEFORE IT IN THE TREE'S ORDER TAKES THE FOCUS, which is the asm view, in the other column; the TM
    // view under it takes its space.
    'lambda-0': ['row[50](column[50](source asm-0) tm-0)', 'asm-0'],
    'tm-0': ['row[50](column[50](source asm-0) lambda-0)', 'lambda-0'],
  },
  keyed: {
    '1': 'row[50](lambda-0 column[50](asm-0 tm-0))',
    '2': 'row[50](source column[50](lambda-0 tm-0))',
    '3': 'row[50](source column[50](asm-0 tm-0))',
    '4': 'row[50](source column[50](lambda-0 asm-0))',
    ']': 'row[50](source asm-0)',
    '[[': 'row[50](source tm-0)',
  },
  dividers: {
    '[]': ['source', 'asm-0', 'lambda-0', 'tm-0'],
    '[0]': ['source', 'asm-0'],
    '[1]': ['lambda-0', 'tm-0'],
  },
}

describe.each([FIRST_LOAD, WIDE_FOUR])('on $name', (layout) => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    if (document.querySelector('#views') !== null) return
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: PROGRAM } })
    await until(idle, 'the first compile')
    await until(() => host('tm-0')?.querySelector('.state-table .state-row') != null, 'the rule table to draw')
    expect(drawn(), 'precondition: the page opened on the first load’s views').toBe('row[50](source tm-0)')
  })

  afterEach(async () => {
    if (!(document.querySelector('#view-keys') as HTMLElement).hidden) await userEvent.keyboard('{Escape}')
  })

  it.each(layout.views)('a ✕ on the %s view, pressed with the pointer', async (leaf) => {
    await layout.make()
    const before = await arm()
    const [tree, focused] = layout.closed[leaf] as readonly [string, string]
    await userEvent.click(host(leaf).querySelector('button.view-close') as HTMLElement)
    await settled(`✕ on ${leaf}`, tree, focused, before)
    expect(document.activeElement, 'the focus is not on the first control of the view that took it').toBe(
      first(focused),
    )
    expect(document.activeElement?.matches(':focus-visible'), 'a pointer press drew a focus ring').toBe(false)
  })

  it.each(layout.views)('reset preset, pressed with the pointer from the %s view', async (leaf) => {
    await layout.make()
    await userEvent.click(host(leaf).querySelector(INSIDE[leaf] as string) as HTMLElement)
    expect(viewOfFocus(), 'precondition: the focus is in the view').toBe(leaf)
    const before = await arm()
    await userEvent.click(document.querySelector('#workspace') as HTMLElement)
    await userEvent.click(document.querySelector('#reset-preset') as HTMLElement)
    await settled(`reset preset from ${leaf}`, 'row[50](source tm-0)', 'tm-0', before)
    expect(document.activeElement).toBe(first('tm-0'))
  })

  /**
   * A VIEW KEY LEAVES THE FOCUS WHERE IT WAS WHILE ITS VIEW IS SHOWN, and gives it to the first view of the new tree
   * that is not the source where it is not (spec §4.5).
   */
  it.each(layout.views)('each view key, pressed from the %s view', async (leaf) => {
    for (const [key, tree] of Object.entries(layout.keyed)) {
      await layout.make()
      await userEvent.click(host(leaf).querySelector(INSIDE[leaf] as string) as HTMLElement)
      const held = document.activeElement
      expect(viewOfFocus(), `precondition: the focus is in the view, before ${key}`).toBe(leaf)
      const before = await arm()
      await userEvent.keyboard(PREFIX)
      await userEvent.keyboard(key)
      const stays = host(leaf) !== null
      const focused = stays ? leaf : firstView(tree)
      await settled(`${key} from ${leaf}`, tree, focused, before, stays ? undefined : focused)
      if (stays) expect(document.activeElement, `${key} from ${leaf} moved the focus`).toBe(held)
      else expect(document.activeElement, `${key} from ${leaf}`).toBe(first(focused))
    }
  })

  /**
   * A DIVIDER DRAGGED WITH THE POINTER MOVES ITS OWN SPLIT AND NO OTHER. The press is the driver's, on the divider,
   * and the release 80 px along it; `divider-drag.test.ts` has the frames of a drag, with events it makes itself.
   * **AND THE FOCUS IS ON WHAT HAD IT**, which the fixture leaves in the TM view: the drag's end left it on `<body>`
   * until `pane-host.ts`'s `resized` (`divider-drag-focus.test.ts` has the caret in an editor).
   */
  it.each(Object.entries(layout.dividers))('the divider at %s, dragged with the pointer', async (path, sides) => {
    await layout.make()
    const before = await arm()
    const was = drawn()
    const held = document.activeElement
    expect(viewOfFocus(), 'precondition: the focus is in a view').toBeDefined()
    const divider = document.querySelector<HTMLElement>(`#views .layout-divider[data-path="${path}"]`) as HTMLElement
    const views = document.querySelector('#views') as HTMLElement
    const [at, area] = [divider.getBoundingClientRect(), views.getBoundingClientRect()]
    const across = divider.getAttribute('aria-orientation') === 'vertical'
    await userEvent.dragAndDrop(divider, views, {
      targetPosition: {
        x: at.left - area.left + (across ? 80 : at.width / 2),
        y: at.top - area.top + (across ? at.height / 2 : 80),
      },
    })
    expect(document.activeElement, 'the drag moved the focus').toBe(held)
    await frames()
    expect(document.activeElement, 'the drag moved the focus, two frames on').toBe(held)
    const now = document.querySelector<HTMLElement>(`#views .layout-divider[data-path="${path}"]`) as HTMLElement
    expect(Number(now.getAttribute('aria-valuenow')), 'the drag did not move its divider').toBeGreaterThan(52)
    // EVERY OTHER SHARE IS THE HALF IT WAS: the tree with this divider's share put back is the tree before the drag.
    const others = [...document.querySelectorAll<HTMLElement>('#views .layout-divider')].filter((d) => d !== now)
    expect(others.map((d) => d.getAttribute('aria-valuenow'))).toEqual(others.map(() => '50'))
    expect(drawn().replace(/\[\d+\]/g, '[50]'), 'the drag changed the tree’s shape').toBe(was)
    for (const leaf of mounted()) {
      const [el, held] = [host(leaf), before.get(leaf)]
      if (held === undefined) throw new Error(`the drag added the ${leaf} view`)
      const same = held.width === el.clientWidth && held.height === el.clientHeight
      expect(same, `the ${leaf} view’s box ${sides.includes(leaf) ? 'did not change' : 'changed'}`).toBe(
        !sides.includes(leaf),
      )
      if (same) expect(el.scrollTop, `the drag reset the ${leaf} view, whose box did not change`).toBe(held.top)
    }
    expect(parseWorkspace(stored())).not.toBeNull()
  })
})
