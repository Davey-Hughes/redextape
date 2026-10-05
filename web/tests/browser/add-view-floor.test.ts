import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, type LayoutNode, MIN_VIEW_PX } from '../../src/layout'
import { DIVIDER_PX } from '../../src/layout-view'
import { defaultWorkspace, parseWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **`+ VIEW` TAKES AN EQUAL SHARE OF THE FOCUSED VIEW'S ROW, AND NO ADD MAKES A VIEW NARROWER THAN 160 PX** — the
 * user's decisions of 2026-10-04. At 1280×800 in Explorer the four default views are 634 px wide; `+ view` beside λ
 * pressed five times gives the top row 3, 4, 5, 6 and 7 equal views, and a sixth press, which would leave each 149.5
 * px, is refused on the notice line and changes nothing; so is an add whose new view has room when a view it shrinks
 * would not. A split still halves the view it is chosen on, refused where a half would be under the floor along the
 * axis it divides. The Stage holds only the leaf bound: a view added there is a tab, and nothing on screen shrinks.
 *
 * Every gesture is real input (`userEvent`): the property is about what a click does. ONE MOUNT FOR THE FILE, for the
 * reason every sibling gives; it opens on a stored layout of 64 views for the cap's case, and each later case starts
 * by setting 1280×800, choosing its preset and pressing *reset preset* (`resetPreset`), so none depends on the views,
 * the preset or the window the case before it left — a case that fails half way through included.
 */

/** The workspace's 64 views: λ across the top, the other 63 in one row below it — `MAX_TREE_LEAVES` of them. */
const SIXTY_FOUR: LayoutNode = {
  kind: 'split',
  dir: 'column',
  sizes: [0.5, 0.5],
  children: [
    { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
    {
      kind: 'split',
      dir: 'row',
      sizes: Array.from({ length: 63 }, () => 1 / 63),
      children: Array.from({ length: 63 }, (_, i) => ({ kind: 'leaf', id: `pane-${i + 1}`, pane: 'asm' }) as const),
    },
  ],
}

const views = () => document.querySelector<HTMLElement>('#views') as HTMLElement
/** The view hosts on the page — every `[data-leaf]` under `#views` but a Stage's tabs, which carry one too. */
const hosts = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')].filter((el) => el.getAttribute('role') !== 'tab')
const ids = () => hosts().map((h) => h.dataset.leaf as string)
const host = (leaf: string) => hosts().find((h) => h.dataset.leaf === leaf) as HTMLElement
const tabs = () => [...document.querySelectorAll<HTMLElement>('#views [role="tab"]')].map((t) => t.dataset.leaf)
const stored = () => localStorage.getItem(LAYOUT_STORAGE_KEY)
const focused = () => parseWorkspace(stored())?.focused
const titleOf = (leaf: string) =>
  (host(leaf).querySelector('.view-title-text') ?? host(leaf).querySelector('.view-title'))?.textContent
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const width = (el: Element) => el.getBoundingClientRect().width
const height = (el: Element) => el.getBoundingClientRect().height
/** The views level with λ's top edge — the top row however the tree nests it. */
const topRow = () =>
  hosts().filter((h) => h.getBoundingClientRect().top === host('lambda-0').getBoundingClientRect().top)
/** Each of `n` views' width in a row `w` px wide: `w` less the `n - 1` dividers, shared equally. */
const share = (w: number, n: number) => (w - DIVIDER_PX * (n - 1)) / n
/** The workspace button's preset, without its `▾`. */
const preset = () => document.querySelector('#workspace')?.textContent?.replace('▾', '').trim()

const ROOM_BESIDE = (title: string) => `no room for another view beside ${title} — close a view or widen the window`
/** A split refused for width — split right, or split down of a view already narrow — and one refused for height. */
const ROOM_SPLIT_NARROW = (title: string) => `no room to split ${title} — close a view or widen the window`
const ROOM_SPLIT_SHORT = (title: string) => `no room to split ${title} — close a view or make the window taller`
const FULL = 'the workspace holds 64 views, the most it can keep — close one to add another'

/** Press `+ view` and pick `label`, with the pointer. */
async function plusView(label = 'λ · program'): Promise<void> {
  await userEvent.click(document.querySelector('#new-view') as HTMLElement)
  const item = () =>
    [...document.querySelectorAll<HTMLButtonElement>('#new-view-menu button')].find((b) => b.textContent === label)
  await until(() => item() !== undefined, `+ view's ${label}`)
  await userEvent.click(item() as HTMLButtonElement)
}

/**
 * The press just made added a λ view, and `count` reaches `n`. **THE NOTICE FIRST**: a press refused says so on the
 * line at once, so a refusal fails here on its own words rather than as a wait for a view that never comes.
 */
async function added(what: string, count: () => number, n: number): Promise<void> {
  expect(noticeText(), what).toBe('view added — λ · program')
  await until(() => count() === n, what)
}

/**
 * Open `leaf`'s `⋯`, choose `split right` (`row`) or `split down` (`column`), and answer the pair that makes *another
 * view of this* — not yet clicked, so a case can take its snapshot after the `⋯` click, which moves the focus into the
 * view, and before the pick.
 */
async function openSplit(leaf: string, dir: 'row' | 'column'): Promise<HTMLButtonElement> {
  const more = host(leaf).querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
  await userEvent.click(more)
  const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement
  await until(() => menu.matches(':popover-open'), `${leaf}'s view menu`)
  await userEvent.click(menu.querySelector(`button.view-split[data-dir="${dir}"]`) as HTMLButtonElement)
  await until(() => menu.querySelector('button[data-same]') !== null, `${leaf}'s split pairs`)
  return menu.querySelector('button[data-same]') as HTMLButtonElement
}

const workspaceMenu = () => document.querySelector<HTMLElement>('#workspace-menu') as HTMLElement

/** Open the workspace menu with the pointer — from shut, since a click on its button while it is open shuts it. */
async function openWorkspace(): Promise<void> {
  if (workspaceMenu().matches(':popover-open')) await userEvent.keyboard('{Escape}')
  await userEvent.click(document.querySelector('#workspace') as HTMLElement)
  await until(() => workspaceMenu().matches(':popover-open'), 'the workspace menu')
}

/** Choose a preset from the workspace menu, with the pointer, and shut the menu, which a preset leaves open. */
async function choosePreset(p: 'explorer' | 'stage'): Promise<void> {
  await openWorkspace()
  await userEvent.click(workspaceMenu().querySelector(`[data-preset="${p}"]`) as HTMLElement)
  if (workspaceMenu().matches(':popover-open')) await userEvent.keyboard('{Escape}')
}

/**
 * Each case's start: the window at 1280×800, preset `p` chosen and *reset preset* pressed, with the pointer — the
 * preset's default views, focused on λ.
 */
async function resetPreset(p: 'explorer' | 'stage' = 'explorer'): Promise<void> {
  await page.viewport(1280, 800)
  await choosePreset(p)
  await openWorkspace()
  await userEvent.click(document.querySelector('#reset-preset') as HTMLElement)
  await until(() => noticeText().endsWith('reset — the default views are back'), 'the reset')
  expect(tabs().length > 0 ? tabs() : ids()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
  expect(focused()).toBe('lambda-0')
}

const live = () => document.querySelector('#live')?.textContent ?? ''

/**
 * Move the top row's divider, between source and λ, `n` key steps with real keys: `ArrowRight` grows source, and
 * `ArrowLeft` grows λ. **FOCUSED BY SCRIPT**: a real click on a divider left the focus on `<body>` (measured; the click
 * is a drag's `pointerdown`, which calls `preventDefault`), and the keys are the gesture these cases need.
 */
async function dragTopDivider(key: 'ArrowRight' | 'ArrowLeft', n: number): Promise<void> {
  const divider = document.querySelector<HTMLElement>(
    '#views > .layout-split > .layout-split[data-dir="row"] > .layout-divider',
  ) as HTMLElement
  expect(divider.compareDocumentPosition(host('lambda-0')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  divider.focus()
  expect(document.activeElement).toBe(divider)
  await userEvent.keyboard(`{${key}}`.repeat(n))
}

/**
 * What a refused add must leave as it was — the views, their sizes, storage, and the focused view — and the live
 * region as it was before the gesture, which the refusal must change.
 */
function snapshot() {
  return {
    state: { ids: ids(), tabs: tabs(), widths: hosts().map(width), stored: stored(), focused: focused() },
    live: live(),
  }
}

/**
 * The refusal said `words` on the line and in the live region, and changed nothing in `before`.
 *
 * **THE LIVE REGION MUST HAVE CHANGED, NOT ONLY READ THE WORDS.** A second refusal in the same words finds them on
 * the line already, so the line alone cannot tell it from a refusal that said nothing; `notice.ts`'s `say` toggles a
 * trailing space on a repeat, so the region changes for a refusal that speaks and stays as it was for one that does
 * not.
 */
function refused(words: string, before: ReturnType<typeof snapshot>): void {
  expect(noticeText()).toBe(words)
  expect(live(), 'the refusal said nothing to the live region').not.toBe(before.live)
  expect(live().trim()).toBe(words)
  expect(snapshot().state).toEqual(before.state)
  expect(document.querySelector<HTMLButtonElement>('#new-view')?.disabled).toBe(false)
  expect(document.activeElement, 'the focus fell to <body>').not.toBe(document.body)
}

beforeAll(async () => {
  await page.viewport(1280, 800)
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({ ...defaultWorkspace(), tree: SIXTY_FOUR, focused: 'lambda-0' }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('+ view and the splits, at 1280×800', () => {
  /**
   * **THE APP NEVER BUILDS A TREE ITS OWN LOADER REFUSES.** A 65th view would make a layout that falls back to the
   * default at the next load; the focused view here is the whole width, so room is not what refuses it. The Stage,
   * which holds no floor, still holds this bound.
   */
  it('refuses a 65th view in the cap’s words, from + view and from a split, and on the Stage', async () => {
    expect(preset()).toBe('Explorer')
    expect(ids().length).toBe(64)
    expect(focused()).toBe('lambda-0')
    expect(titleOf('lambda-0')).toBe('λ · program')
    expect(width(host('lambda-0'))).toBe(1280)

    let before = snapshot()
    await plusView()
    refused(FULL, before)

    const pick = await openSplit('lambda-0', 'row')
    before = snapshot()
    await userEvent.click(pick)
    refused(FULL, before)
    expect(host('lambda-0').contains(document.activeElement), 'the focus left the view the split was chosen on').toBe(
      true,
    )

    await choosePreset('stage')
    await until(() => tabs().length === 64, 'the stage')
    expect(preset()).toBe('Stage')
    expect(focused()).toBe('lambda-0')
    expect(titleOf('lambda-0')).toBe('λ · program')
    before = snapshot()
    await plusView()
    refused(FULL, before)
  })

  it('gives the row an equal share for each of five presses, every view at least 160 px', async () => {
    await resetPreset()
    expect(preset()).toBe('Explorer')
    expect(titleOf('lambda-0')).toBe('λ · program')
    expect(width(views())).toBe(1280)
    expect(width(host('lambda-0'))).toBe(634)
    // THE DIVIDER THE ARITHMETIC SUBTRACTS IS THE ONE THE STYLESHEET DRAWS, across a row and down a column.
    const rows = [...document.querySelectorAll('.layout-split[data-dir="row"] > .layout-divider')]
    const columns = [...document.querySelectorAll('.layout-split[data-dir="column"] > .layout-divider')]
    expect([rows.length, columns.length]).toEqual([2, 1])
    for (const d of rows) expect(width(d)).toBe(DIVIDER_PX)
    for (const d of columns) expect(height(d)).toBe(DIVIDER_PX)

    for (let press = 1; press <= 5; press++) {
      await plusView()
      await added(`press ${press}`, () => ids().length, 4 + press)
      const row = topRow()
      expect(row.length, `press ${press}: views in the top row`).toBe(2 + press)
      for (const v of row) {
        expect(Math.abs(width(v) - share(1280, 2 + press)), `press ${press}: ${v.dataset.leaf}`).toBeLessThan(1)
        expect(width(v)).toBeGreaterThanOrEqual(MIN_VIEW_PX)
      }
      // ONE ROW, NOT A SPLIT NESTED PER PRESS: every view in it is a child of the same split.
      expect(new Set(row.map((v) => v.parentElement)).size).toBe(1)
    }
  })

  it('refuses a sixth press, says why on the notice line, and changes nothing', async () => {
    await resetPreset()
    for (let press = 1; press <= 5; press++) {
      await plusView()
      await added(`press ${press}`, () => ids().length, 4 + press)
    }
    expect(preset()).toBe('Explorer')
    expect(topRow().length).toBe(7)
    const at = focused() as string
    expect(titleOf(at)).toBe('λ · program')
    // AN EIGHTH VIEW IN THE ROW WOULD BE UNDER THE FLOOR — arithmetic, not a measurement: (1280 − 7 × 12) / 8 = 149.5.
    expect(width(views())).toBe(1280)

    const before = snapshot()
    await plusView()
    refused(ROOM_BESIDE('λ · program'), before)
  })

  it('refuses split right on a view narrower than 332 px, and still halves a wide one', async () => {
    await resetPreset()
    await plusView()
    await added('press 1', () => ids().length, 5)
    await plusView()
    await added('press 2', () => ids().length, 6)
    expect(preset()).toBe('Explorer')
    const at = focused() as string
    expect(titleOf(at)).toBe('λ · program')
    expect(width(host(at))).toBeLessThan(320)

    const pick = await openSplit(at, 'row')
    const before = snapshot()
    await userEvent.click(pick)
    refused(ROOM_SPLIT_NARROW('λ · program'), before)
    expect(host(at).contains(document.activeElement), 'the focus left the view the split was chosen on').toBe(true)

    // A VIEW WITH ROOM FOR TWO HALVES IS STILL SPLIT IN TWO.
    expect(width(host('asm-0'))).toBe(634)
    await userEvent.click(await openSplit('asm-0', 'row'))
    await until(() => ids().length === 7, 'the split')
    const made = focused() as string
    expect(made).not.toBe('asm-0')
    expect(width(host('asm-0'))).toBe(311)
    expect(width(host(made))).toBe(311)
  })

  /**
   * **SPLIT DOWN IS HELD TO THE HEIGHT IT DIVIDES**, as well as to width: the view it refuses here is 634 px wide, so
   * only its height can refuse it, and the words say so.
   */
  it('refuses split down on a view shorter than 332 px, in its own words', async () => {
    await resetPreset()
    expect(preset()).toBe('Explorer')
    expect(titleOf('lambda-0')).toBe('λ · program')
    const tall = height(host('lambda-0'))
    expect(tall).toBeGreaterThanOrEqual(2 * MIN_VIEW_PX + DIVIDER_PX)
    await userEvent.click(await openSplit('lambda-0', 'column'))
    await until(() => ids().length === 5, 'the split')
    const at = focused() as string
    expect(at).not.toBe('lambda-0')
    expect(titleOf(at)).toBe('λ · program')
    expect(Math.abs(height(host(at)) - height(host('lambda-0')))).toBeLessThan(1)
    expect(height(host(at))).toBeGreaterThanOrEqual(MIN_VIEW_PX)
    expect(height(host(at))).toBeLessThan(320)
    expect(width(host(at))).toBe(634)

    const pick = await openSplit(at, 'column')
    const before = snapshot()
    await userEvent.click(pick)
    refused(ROOM_SPLIT_SHORT('λ · program'), before)
    expect(host(at).contains(document.activeElement), 'the focus left the view the split was chosen on').toBe(true)
  })

  /**
   * **A VIEW THE ADD SHRINKS COUNTS, NOT ONLY THE ONE IT MAKES** (the user's decision 2). λ is dragged by keyboard to
   * 0.14 of its row, 177.52 px; `+ view` beside it would give the new view 418.67 px and take λ to 117.23, so it is
   * refused for λ's sake.
   */
  it('refuses + view where the new view has room but the view beside it would go under 160 px', async () => {
    await resetPreset()
    expect(preset()).toBe('Explorer')
    expect(titleOf('lambda-0')).toBe('λ · program')
    await dragTopDivider('ArrowRight', 18)
    await until(() => Math.abs(width(host('lambda-0')) - 177.52) < 1, 'λ at 0.14 of its row')
    expect(focused()).toBe('lambda-0')
    expect(width(host('lambda-0'))).toBeGreaterThanOrEqual(MIN_VIEW_PX)

    const before = snapshot()
    await plusView()
    refused(ROOM_BESIDE('λ · program'), before)
  })

  /**
   * **ANY VIEW IN THE ROW, NOT ONLY THE ONE BESIDE IT.** Source is dragged to 0.14 of the row, 177.52 px, and λ, still
   * focused, has 1,090.48: `+ view` beside λ would leave λ 720.11 and the new view 418.67, and take source to 117.23.
   */
  it('refuses + view where another view in the row would go under 160 px', async () => {
    await resetPreset()
    expect(preset()).toBe('Explorer')
    expect(titleOf('lambda-0')).toBe('λ · program')
    await dragTopDivider('ArrowLeft', 18)
    await until(() => Math.abs(width(host('source')) - 177.52) < 1, 'source at 0.14 of its row')
    expect(focused()).toBe('lambda-0')
    expect(width(host('lambda-0'))).toBeGreaterThan(1000)

    const before = snapshot()
    await plusView()
    refused(ROOM_BESIDE('λ · program'), before)
  })

  /**
   * **A SPLIT DOWN IS HELD TO WIDTH TOO** (the user's decision 2, the re-review's finding): it makes a view as narrow
   * as the one it halves. λ is dragged to 0.12 of its row, 152.16 px; its halves would be about 165 px tall, which
   * passes the height floor, and 152.16 wide, which does not — so it is refused in the width's words.
   */
  it("refuses split down of a view already narrower than 160 px, in the width's words", async () => {
    await resetPreset()
    expect(preset()).toBe('Explorer')
    expect(titleOf('lambda-0')).toBe('λ · program')
    await dragTopDivider('ArrowRight', 19)
    await until(() => Math.abs(width(host('lambda-0')) - 152.16) < 1, 'λ at 0.12 of its row')
    expect(height(host('lambda-0'))).toBeGreaterThanOrEqual(2 * MIN_VIEW_PX + DIVIDER_PX)

    const pick = await openSplit('lambda-0', 'column')
    const before = snapshot()
    await userEvent.click(pick)
    refused(ROOM_SPLIT_NARROW('λ · program'), before)
  })

  /**
   * **ON THE STAGE ONLY THE LEAF BOUND HOLDS** (the user's decision, 2026-10-04): a view added there is a tab, and
   * nothing on screen shrinks. From the default at 1280, where the Stage's inspector leaves `#views` 992 px wide, the
   * fourth press is one tiles would refuse there (155.3 px each, by arithmetic) and the Stage adds it; at 390, where
   * `#views` is 102 px and every tile would be under the floor, a press adds another tab.
   */
  it('adds on the Stage past the floor tiles would hold, at 1280 and at 390', async () => {
    await resetPreset('stage')
    expect(preset()).toBe('Stage')
    expect(ids()).toEqual(['lambda-0'])
    expect(titleOf('lambda-0')).toBe('λ · program')
    expect(width(views())).toBe(992)

    for (let press = 1; press <= 4; press++) {
      await plusView()
      await added(`press ${press}`, () => tabs().length, 4 + press)
    }

    await page.viewport(390, 844)
    await until(() => width(views()) === 102, '#views at 390')
    expect(preset()).toBe('Stage')
    expect(tabs().length).toBe(8)
    await plusView()
    await added('press at 390', () => tabs().length, 9)
    expect(ids().length, 'the Stage shows one view').toBe(1)
  })
})
