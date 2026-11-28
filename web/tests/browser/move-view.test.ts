import type { EditorView } from '@codemirror/view'
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import {
  LAYOUT_STORAGE_KEY,
  type LayoutNode,
  leaves,
  MIN_VIEW_PX,
  MOVE_DIRECTIONS,
  type MoveDirection,
  moveLeaf,
} from '../../src/layout'
import { DIVIDER_PX, KEY_STEP } from '../../src/layout-view'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { clickWorkspaceItem, live, mounted, PREFIX, SHELL, sourceBeside, stateIdle, until } from './harness'

/** The tree the app stored last, which is the tree on screen once a gesture has run. */
const storedTree = (): LayoutNode => JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}').tree

const menuOf = (leaf: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-leaf="${leaf}"] .view-menu`)

/** Open `leaf`'s `⋯` menu with a click, as a user opens it. */
const openMenu = async (leaf: string): Promise<void> => {
  const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
  if (more === null) throw new Error(`${leaf} has no ⋯`)
  await userEvent.click(more)
  await until(() => menuOf(leaf)?.matches(':popover-open') === true, `${leaf}'s menu to open`)
}

/** Close `leaf`'s open menu with Escape, as a user closes it. */
const shut = async (leaf: string): Promise<void> => {
  await userEvent.keyboard('{Escape}')
  await until(() => menuOf(leaf)?.matches(':popover-open') === false, `${leaf}'s menu to close`)
}

const moveItem = (leaf: string, d: MoveDirection): HTMLButtonElement => {
  const item = document.querySelector<HTMLButtonElement>(
    `[data-leaf="${leaf}"] button.view-move[data-direction="${d}"]`,
  )
  if (item === null) throw new Error(`${leaf}'s menu has no move view ${d}`)
  return item
}

/** Move `leaf` one step `d` with clicks on its menu, and wait for the tree `moveLeaf` makes to be stored. */
const move = async (leaf: string, d: MoveDirection): Promise<void> => {
  const want = JSON.stringify(moveLeaf(storedTree(), leaf, d))
  await openMenu(leaf)
  await userEvent.click(moveItem(leaf, d))
  await until(() => JSON.stringify(storedTree()) === want, `${leaf} moved ${d} to be stored`)
}

/**
 * How `leaf`'s open menu draws its four move items and what a screen reader says of each: `greyed` is the style a
 * disabled item takes, faded with no pointer, and `plain` an enabled item's.
 */
const drawn = (leaf: string) =>
  MOVE_DIRECTIONS.map((d) => {
    const item = moveItem(leaf, d)
    const style = getComputedStyle(item)
    const opacity = Number(style.opacity)
    const look =
      opacity < 1 && style.cursor === 'default'
        ? 'greyed'
        : opacity === 1 && style.cursor === 'pointer'
          ? 'plain'
          : style
    return { d, look, said: computeAccessibleDescription(item) }
  })

const views = (): DOMRect => (document.querySelector('#views') as HTMLElement).getBoundingClientRect()

/** The tiled area made `width` wide, or `height` tall, by the window: what is around it may be either. */
const viewsSized = async (extent: 'width' | 'height', px: number): Promise<void> => {
  for (let i = 0; i < 3 && Math.abs(views()[extent] - px) > 1; i++)
    if (extent === 'width') await page.viewport(Math.round(window.innerWidth + px - views().width), window.innerHeight)
    else await page.viewport(window.innerWidth, Math.round(window.innerHeight + px - views().height))
}

/** Where each view of `tree` is drawn, as plain numbers. */
const placesOf = (tree: LayoutNode): Record<string, { left: number; top: number; width: number; height: number }> =>
  Object.fromEntries(
    leaves(tree).map((l) => {
      const r = (document.querySelector(`#views [data-leaf="${l.id}"]`) as HTMLElement).getBoundingClientRect()
      return [l.id, { left: r.left, top: r.top, width: r.width, height: r.height }]
    }),
  )

/** Every view of `was` drawn within 1 px of where it was, each edge and extent. */
const placedAs = (was: ReturnType<typeof placesOf>, gesture: string): void => {
  for (const [leaf, box] of Object.entries(was)) {
    const now = placesOf({ kind: 'leaf', id: leaf, pane: 'source' })[leaf] ?? box
    for (const k of ['left', 'top', 'width', 'height'] as const)
      expect(Math.abs(now[k] - box[k]), `after ${gesture}, ${leaf}'s ${k}`).toBeLessThanOrEqual(1)
  }
}

/**
 * MOVING A VIEW FROM ITS `⋯` MENU — the view layouts spec §9.1, §9.3's disabled items and their words, §9.4 and
 * §9.5's focus. The tree a move makes is `moveLeaf`'s, and the refusals `moveRefusal`'s, whose node tests hold their
 * cases; this file holds that the app runs them on the tree and the area on screen, stores and draws the tree, greys
 * a refused item with its reason and keeps the focus in the view.
 */
describe('moving a view', () => {
  beforeAll(async () => {
    // TWO VIEWS SIDE BY SIDE, SEEDED BEFORE `main.ts` IS IMPORTED: each refusal below is then one a reader can work out.
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      serializeWorkspace({ ...defaultWorkspace('wide'), tree: sourceBeside('tm-0', 'tm'), focused: 'source' }),
    )
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    const view: EditorView = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(stateIdle, 'the first compile')
  })

  // A FAILED ASSERTION LEAVES ITS MENU OPEN, AND THE NEXT TEST'S CLICK ON `⋯` WOULD BE A LIGHT DISMISS.
  afterEach(async () => {
    if (document.querySelector('.view-menu:popover-open') !== null) await userEvent.keyboard('{Escape}')
  })

  it('greys a move at the edge and one that would leave a view under the floor, each with its reason', async () => {
    const tree = storedTree()
    expect(
      leaves(tree).map((l) => l.id),
      'precondition: the seeded two views',
    ).toEqual(['source', 'tm-0'])
    expect(tree.kind === 'split' ? tree.dir : 'leaf', 'precondition: side by side').toBe('row')
    // THE TILED AREA UNDER TWICE THE FLOOR TALL: A MOVE UP OR DOWN WOULD HALVE IT UNDER THE FLOOR, AND ONE LEFT TRADES
    // PLACES.
    const tall = window.innerHeight
    const around = tall - views().height
    const short = 2 * MIN_VIEW_PX + DIVIDER_PX
    try {
      await page.viewport(1280, Math.round(around + 300))
      await until(() => views().height < short, 'the tiled area to be under twice the floor tall').catch(() => {})
      expect(views().height, 'precondition: a half of the tiled area is under the floor').toBeLessThan(short)
      await openMenu('tm-0')
      expect(drawn('tm-0')).toEqual([
        { d: 'left', look: 'plain', said: '' },
        { d: 'right', look: 'greyed', said: 'this view is as far right as it can go' },
        { d: 'up', look: 'greyed', said: 'no room to move this view up — close a view or make the window taller' },
        { d: 'down', look: 'greyed', said: 'no room to move this view down — close a view or make the window taller' },
      ])
      await shut('tm-0')
    } finally {
      await page.viewport(1280, tall)
      await until(() => views().height >= short, 'the tiled area to be as tall as it was')
    }
  })

  it('moves the TM view, draws and stores the tree moveLeaf makes, keeps the focus in it and says so', async () => {
    const before = storedTree()
    const d = MOVE_DIRECTIONS.find((dir) => moveLeaf(before, 'tm-0', dir) !== null)
    expect(d, 'precondition: the TM view can move some way').toBeDefined()
    const want = moveLeaf(before, 'tm-0', d as MoveDirection) as LayoutNode
    await move('tm-0', d as MoveDirection)
    expect(mounted()).toEqual(leaves(want).map((l) => l.id))
    expect(document.activeElement?.closest('[data-leaf]')?.getAttribute('data-leaf')).toBe('tm-0')
    // WHAT MOVED AND WHICH WAY (§9.5), for a reader who does not see the views trade places.
    expect(live()).toBe(`view moved ${d} — TM · program`)
  })

  it('moves the source view down, then greys the move it can no longer take, with its reason', async () => {
    await move('source', 'down')
    const tree = storedTree()
    expect(moveLeaf(tree, 'source', 'down'), 'precondition: the source view is at the bottom edge').toBeNull()
    await openMenu('source')
    expect(drawn('source')).toEqual(
      MOVE_DIRECTIONS.map((d) =>
        moveLeaf(tree, 'source', d) === null
          ? { d, look: 'greyed', said: `this view is as far ${d} as it can go` }
          : { d, look: 'plain', said: '' },
      ),
    )
    await shut('source')
  })

  it('offers the four on the source view too', async () => {
    await openMenu('source')
    expect(MOVE_DIRECTIONS.map((d) => computeAccessibleName(moveItem('source', d)))).toEqual(
      MOVE_DIRECTIONS.map((d) => `move view ${d}`),
    )
    await shut('source')
  })

  it('removes the four from every view on the Stage, and brings them back in tiles', () => {
    clickWorkspaceItem('[data-switch="views"][data-value="stage"]')
    // TILES AGAIN WHERE AN ASSERTION ON THE STAGE FAILED: the case after this one closes views in tiles.
    try {
      const shown = mounted()
      expect(shown, 'precondition: one view on the Stage').toHaveLength(1)
      expect(document.querySelector(`[data-leaf="${shown[0]}"] button.view-move`)).toBeNull()
    } finally {
      clickWorkspaceItem('[data-switch="views"][data-value="tiles"]')
    }
    for (const id of mounted())
      expect(document.querySelector(`[data-leaf="${id}"] button.view-move`), id).not.toBeNull()
  })

  it('greys all four on a view left alone, saying it has nowhere to go', async () => {
    for (const id of mounted().filter((leaf) => leaf !== 'source')) {
      await userEvent.click(document.querySelector(`[data-leaf="${id}"] button.view-close`) as HTMLButtonElement)
      await until(() => !mounted().includes(id), `${id} to close`)
    }
    expect(mounted(), 'precondition: the source view alone').toEqual(['source'])
    await openMenu('source')
    expect(drawn('source')).toEqual(
      MOVE_DIRECTIONS.map((d) => ({ d, look: 'greyed', said: 'this view is the only one, so it has nowhere to go' })),
    )
    await shut('source')
  })

  /**
   * **A MOVE STRAIGHT BACK FROM THE MENU** (spec §9.6), in the whole-branch review's example: all four in two columns of
   * two, the view under the source view at 0.3 of their column. Moved right it leaves the column, a strip 0.15 of the
   * width; moved left as §9.2 makes it, it would trade slots with the source view, which would go from 0.35 of the width
   * to 0.15. The move back puts every view where it was, at its size.
   */
  describe('moving back', () => {
    /** The review's example, which each case starts from and each move back puts back. */
    let example: LayoutNode
    /** The view under the source view: R in the review's example. */
    let a: string
    /** Its share of the column it shares with the source view. */
    let b: number
    let window0: { width: number; height: number }

    beforeAll(async () => {
      window0 = { width: window.innerWidth, height: window.innerHeight }
      for (const kind of ['lambda', 'rxm', 'tm']) {
        const toggle = document.querySelector<HTMLButtonElement>(
          `#views-shown button[data-shows="${kind}"][aria-pressed="false"]`,
        )
        if (toggle !== null) await userEvent.click(toggle)
      }
      // A TILED AREA 1,280 PX WIDE: R MOVED RIGHT IS THEN 0.15 OF 1,256 PX, ABOVE THE FLOOR.
      await viewsSized('width', 1280)
      const four = storedTree()
      const left = four.kind === 'split' ? four.children[0] : undefined
      expect(left?.kind === 'split' && left.dir, 'precondition: two columns of two').toBe('column')
      expect(leaves(four)[0]?.id, 'precondition: the source view first').toBe('source')
      // THE SOURCE VIEW'S COLUMN TAKEN TO 0.7 AND 0.3 BY ITS DIVIDER'S KEYS, `KEY_STEP` A PRESS: A DRAG WOULD TAKE A
      // POINTER CAPTURE, WHICH IN THE `firefox` PROJECT TAKES THE CLICKS OF EVERY OTHER FILE'S TAB.
      const divider = document.querySelector<HTMLElement>('#views .layout-divider[data-path="[0]"]') as HTMLElement
      divider.focus()
      await userEvent.keyboard('{ArrowDown}'.repeat(Math.round(0.2 / KEY_STEP)))
      await until(() => {
        const t = storedTree()
        return t.kind === 'split' && t.children[0]?.kind === 'split' && (t.children[0].sizes[0] ?? 0) > 0.65
      }, 'the divider to be stored at 0.7')
      example = storedTree()
      const col = example.kind === 'split' ? example.children[0] : undefined
      a = col?.kind === 'split' ? (col.children[1] as { id: string }).id : ''
      b = col?.kind === 'split' ? (col.sizes[1] ?? 0) : 0
      expect(b, 'precondition: the view under the source view at about 0.3 of the column').toBeLessThan(0.35)
    })

    afterAll(async () => {
      await page.viewport(window0.width, window0.height)
    })

    it('puts every view back from the menu, where the move left as §9.2 makes it would trade two slots', async () => {
      expect(storedTree(), 'precondition: the example').toEqual(example)
      const was = placesOf(example)
      await move(a, 'right')
      const right = storedTree()
      expect(moveLeaf(right, a, 'left'), 'precondition: left as §9.2 makes it is another tree').not.toEqual(example)
      await openMenu(a)
      expect(drawn(a)[0], 'the move back is not offered').toEqual({ d: 'left', look: 'plain', said: '' })
      await userEvent.click(moveItem(a, 'left'))
      // THE ARRANGEMENT STORED IS THE ONE PUT BACK, WHICH A RELOAD SHOWS.
      await until(() => JSON.stringify(storedTree()) === JSON.stringify(example), 'the tree before to be stored')
      placedAs(was, 'the move back')
      expect(document.activeElement?.closest('[data-leaf]')?.getAttribute('data-leaf')).toBe(a)
      expect(live()).toBe('view moved left — rxm · program')
    })

    it('takes the move back where the move left as §9.2 makes it is refused for room', async () => {
      const was = placesOf(example)
      await move(a, 'right')
      // NARROWED UNTIL THE TRADE WOULD TAKE THE SOURCE VIEW TO b / 2 OF THE WIDTH LESS TWO DIVIDERS, UNDER THE FLOOR. THE
      // MOVE BACK WIDENS BOTH VIEWS IT TAKES HEIGHT FROM, AND LEAVES THEM TALL ENOUGH.
      const width = views().width
      try {
        await viewsSized('width', Math.floor((MIN_VIEW_PX - 10) / (b / 2) + 2 * DIVIDER_PX))
        expect((b / 2) * (views().width - 2 * DIVIDER_PX), 'precondition: the trade is under the floor').toBeLessThan(
          MIN_VIEW_PX,
        )
        await openMenu(a)
        expect(drawn(a)[0], 'the move back is not offered where the trade is refused').toEqual({
          d: 'left',
          look: 'plain',
          said: '',
        })
        await userEvent.click(moveItem(a, 'left'))
        await until(() => JSON.stringify(storedTree()) === JSON.stringify(example), 'the tree before to be stored')
      } finally {
        await viewsSized('width', width)
      }
      placedAs(was, 'the move back and the window as it was')
    })

    it('takes the move back where the window has shrunk since, and draws the tree before in it', async () => {
      const was = placesOf(example)
      await move(a, 'right')
      const height = views().height
      try {
        // MADE SHORTER UNTIL R BACK AT b OF THE HEIGHT LESS A DIVIDER IS UNDER THE FLOOR, AS THE WINDOW WOULD DRAW
        // IT HAD R NOT MOVED.
        await viewsSized('height', Math.floor((MIN_VIEW_PX - 10) / b + DIVIDER_PX))
        expect(b * (views().height - DIVIDER_PX), 'precondition: the tree before is under the floor').toBeLessThan(
          MIN_VIEW_PX,
        )
        await openMenu(a)
        expect(drawn(a)[0], 'the move back is refused in a window made smaller').toEqual({
          d: 'left',
          look: 'plain',
          said: '',
        })
        await userEvent.click(moveItem(a, 'left'))
        await until(() => JSON.stringify(storedTree()) === JSON.stringify(example), 'the tree before to be stored')
        expect(placesOf(example)[a]?.height, 'precondition: the view moved back under the floor').toBeLessThan(
          MIN_VIEW_PX,
        )
      } finally {
        await viewsSized('height', height)
      }
      placedAs(was, 'the move back and the window as it was')
    })

    it('takes the move back by its key at the size the move was made at, of a view under the floor before it', async () => {
      expect(storedTree(), 'precondition: the example').toEqual(example)
      const height = views().height
      try {
        // MADE SHORTER UNTIL R AT b OF THE HEIGHT LESS A DIVIDER IS UNDER THE FLOOR: THE MOVE RIGHT MAKES IT AS TALL AS
        // THE AREA, AND THE MOVE BACK GIVES IT ITS OWN HEIGHT BACK.
        await viewsSized('height', Math.floor((MIN_VIEW_PX - 10) / b + DIVIDER_PX))
        const was = placesOf(example)
        expect(was[a]?.height, 'precondition: the view under the floor before the move').toBeLessThan(MIN_VIEW_PX)
        await move(a, 'right')
        await openMenu(a)
        expect(drawn(a)[0], 'the move back is refused at the size the move was made at').toEqual({
          d: 'left',
          look: 'plain',
          said: '',
        })
        await shut(a)
        // THE KEY GOES TO THE VIEW WITH THE FOCUS, WHICH THE MENU CLOSED IN.
        await userEvent.keyboard(PREFIX)
        await userEvent.keyboard('h')
        await until(() => JSON.stringify(storedTree()) === JSON.stringify(example), 'the tree before to be stored')
        placedAs(was, 'the move back')
        expect(live()).toBe('view moved left — rxm · program')
      } finally {
        await viewsSized('height', height)
      }
    })
  })
})
