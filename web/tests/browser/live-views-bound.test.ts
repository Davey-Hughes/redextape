import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, MAX_TREE_LEAVES, MIN_VIEW_PX } from '../../src/layout'
import { DIVIDER_PX } from '../../src/layout-view'
import { parseWorkspace, serializeWorkspace } from '../../src/workspace'
import {
  focusInPage,
  fourViewWorkspace,
  liveViewCount,
  mounted,
  noticeText,
  rowOfLeaves,
  SHELL,
  stateIdle,
  storedLayoutText,
  until,
  views,
  workspaceMenu,
  workspaceNameText,
} from './harness'
import { plusView, resetOffered, userPickInWorkspaceMenu } from './user-event-fixture'

/**
 * **THE 64-VIEW BOUND IS ON EVERY LIVE VIEW, AND `+ VIEW` IS HELD TO IT** — the view layouts spec §5.6. A view a
 * remembered arrangement holds is live: it is kept off the page, or after a reload built when its arrangement is
 * entered. `parseWorkspace` refuses a stored workspace whose tree and remembered arrangements name more than 64 ids
 * between them. So an add is refused at 64 live views, however few of them the tree on screen holds: the app never
 * stores a workspace its own loader refuses.
 *
 * The page opens on a stored workspace of 63: the four views on screen, and 59 λ views in the arrangement remembered
 * for the λ view alone. Storage is read once, at the mount, so the workspace is stored before it, as
 * `add-view-floor.test.ts` stores its own. **THE CASES RUN IN ORDER ON ONE PAGE**, each from the state the one before
 * left, and each asserts that state first.
 *
 * **BOTH SIDES OF THE BOUND**: the add at 63 goes through and the add at 64 does not. With 64 as the only case, a
 * bound a view lower (`>= MAX_TREE_LEAVES - 1` in `pane-host.ts`'s `admit`) would pass.
 *
 * **AND THE NOTICE IS HELD TO WHAT IS TRUE WHERE IT IS SHOWN.** A `✕` on a kind's last view leaves the tree before it
 * remembered, with the closed view's leaf in it, so it makes no room, and "close one to add another" alone would not
 * be true after it. The notice counts the views not on screen, and names *reset preset* for a close that makes no
 * room. The cases here take each remedy in turn: a `✕` that makes none, a `✕` that makes some, and the reset.
 *
 * `live-views-bound-switch.test.ts` holds the bound for a switch. Each needs another stored workspace and so another
 * mount.
 */

/** 59 λ views in one row: the arrangement the stored workspace remembers for the λ view alone. */
const REMEMBERED = rowOfLeaves(59)

const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']
/** The view the first add makes: the leaf counter steps past every live id at the load, the 59 off the screen too. */
const ADDED = 'pane-60'
/** The view added once `ADDED` is closed: a refused add mints no id, so it is the next number. */
const AGAIN = 'pane-61'
/** What makes room, as the notice says it in a workspace that is a preset; a custom one has a step before the reset. */
const REMEDY = 'close one to add another, or reset preset if that makes no room'
const REMEDY_CUSTOM = 'close one to add another, or choose a preset and reset preset if that makes no room'
const full = (off: number, remedy = REMEDY): string =>
  `the workspace holds 64 views, ${off} of them not on screen, the most it can keep — ${remedy}`

/** A view's `✕`, pressed with the pointer, after which the focus is somewhere in the page (spec §14 item 19). */
const close = async (id: string): Promise<void> => {
  await userEvent.click(document.querySelector(`#views [data-leaf="${id}"] button.view-close`) as HTMLElement)
  await focusInPage(`the ✕ of ${id}`)
}

beforeAll(async () => {
  await page.viewport(1280, 896)
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({ ...fourViewWorkspace(), arrangements: { lambda: REMEMBERED } }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
})

describe('+ view, with four views on screen and 59 more remembered', () => {
  it('adds a view at 63 live views, which makes 64', async () => {
    // A STORED WORKSPACE THE LOADER REFUSED WOULD HAVE OPENED ON THE DEFAULT, the source beside the TM view.
    expect(mounted(), 'precondition: the page opened on the stored workspace').toEqual(FOUR)
    const opened = parseWorkspace(storedLayoutText())
    expect(Object.keys(opened?.arrangements ?? {}), 'precondition: one arrangement is remembered').toEqual(['lambda'])
    expect(liveViewCount(), 'precondition: the live views are one short of the bound').toBe(MAX_TREE_LEAVES - 1)
    expect(opened?.focused, 'precondition: + view adds beside the λ view').toBe('lambda-0')

    await plusView('λ · program', '+ view’s λ · program')
    expect(mounted(), 'the add at 63 live views was refused').toEqual(['source', 'lambda-0', ADDED, 'asm-0', 'tm-0'])
    expect(liveViewCount()).toBe(MAX_TREE_LEAVES)
  })

  /**
   * **THE NOTICE AND WHAT IS LEFT AS IT WAS ARE EACH ASSERTED SOFT**, so an add that went through is reported in
   * each: by the words on the line, by the view it made, and by the workspace it stored. The stored workspace is
   * compared whole and reported as a yes or a no, since two workspaces of 64 views are not a diff anyone reads.
   */
  it('refuses the next at 64, counting the views not on screen, and changes nothing', async () => {
    expect(liveViewCount(), 'precondition: the live views are exactly the bound').toBe(MAX_TREE_LEAVES)
    // ROOM IS NOT WHAT REFUSES IT: a fourth view in the λ view's row leaves each an equal share over the floor.
    const share = (views().getBoundingClientRect().width - 3 * DIVIDER_PX) / 4
    expect(share, 'precondition: a fourth view in the row keeps the floor').toBeGreaterThanOrEqual(MIN_VIEW_PX)

    const before = { mounted: mounted(), stored: storedLayoutText() }
    await plusView('λ · program', '+ view’s λ · program')
    await focusInPage('+ view’s λ · program, refused at 64 live views')
    expect.soft(noticeText(), 'the add was not refused as a full workspace is').toBe(full(59))
    expect.soft(mounted(), 'the refused add changed the views on the page').toEqual(before.mounted)
    expect.soft(storedLayoutText() === before.stored, 'the refused add stored another workspace').toBe(true)
  })

  it('adds once a ✕ has made room: on a second view of a kind, which no arrangement remembers', async () => {
    expect(mounted(), 'precondition: two λ views on screen').toEqual(['source', 'lambda-0', ADDED, 'asm-0', 'tm-0'])
    await close(ADDED)
    expect(liveViewCount(), 'precondition: the close took a live view away').toBe(MAX_TREE_LEAVES - 1)
    document.querySelector<HTMLElement>('#views [data-leaf="lambda-0"] button.view-title')?.focus()
    await plusView('λ · program', '+ view’s λ · program')
    expect(noticeText(), 'the add after a close that made room was refused').toBe('view added — λ · program')
    expect(mounted()).toEqual(['source', 'lambda-0', AGAIN, 'asm-0', 'tm-0'])
    expect(liveViewCount()).toBe(MAX_TREE_LEAVES)
  })

  it('is refused again after a ✕ that made no room, the closed view counted among those not on screen', async () => {
    await close('tm-0')
    expect(mounted(), 'precondition: the TM view is closed').toEqual(['source', 'lambda-0', AGAIN, 'asm-0'])
    expect(liveViewCount(), 'precondition: the tree before the ✕ is remembered, and still names the closed view').toBe(
      MAX_TREE_LEAVES,
    )
    // BESIDE THE λ VIEW AGAIN, where the row has room: the ✕ moved the focus to the view before the closed one.
    document.querySelector<HTMLElement>('#views [data-leaf="lambda-0"] button.view-title')?.focus()
    const before = { mounted: mounted(), stored: storedLayoutText() }
    await plusView('λ · program', '+ view’s λ · program')
    await focusInPage('+ view’s λ · program, refused after a ✕ that made no room')
    expect.soft(noticeText(), 'the notice does not count the view the ✕ closed').toBe(full(60))
    expect.soft(mounted(), 'the refused add changed the views on the page').toEqual(before.mounted)
    expect.soft(storedLayoutText() === before.stored, 'the refused add stored another workspace').toBe(true)
  })

  /**
   * The source view's id is `source` wherever it is, so adding it where an arrangement still holds it adds no view
   * to the workspace: an `admit` that asked only how many were live would refuse it.
   */
  it('adds the source view at 64, where a remembered arrangement holds it already', async () => {
    await close('source')
    expect(mounted(), 'precondition: the source view is closed').toEqual(['lambda-0', AGAIN, 'asm-0'])
    expect(liveViewCount(), 'precondition: the workspace is still at the bound, the source view among the 64').toBe(
      MAX_TREE_LEAVES,
    )
    await plusView('source', '+ view’s source')
    expect(mounted(), 'the source view was refused').toContain('source')
    expect(mounted()).toHaveLength(4)
    expect(liveViewCount(), 'the source view was counted as a 65th').toBe(MAX_TREE_LEAVES)
  })

  /**
   * **A SPLIT ADDS THE SOURCE VIEW THERE TOO.** `split` tells `admit` the id its leaf takes as `addView` does; with
   * that left out, a split's *source* would be refused at 64 where `+ view`'s is added.
   */
  it('adds the source view at 64 from a split as well', async () => {
    await close('source')
    expect(mounted(), 'precondition: the source view is closed').toEqual(['lambda-0', AGAIN, 'asm-0'])
    expect(liveViewCount(), 'precondition: the workspace is at the bound, the source view among the 64').toBe(
      MAX_TREE_LEAVES,
    )
    const more = document.querySelector<HTMLElement>('#views [data-leaf="lambda-0"] button.view-more') as HTMLElement
    await userEvent.click(more)
    const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement
    await userEvent.click(menu.querySelector('button.view-split[data-dir="row"]') as HTMLElement)
    await until(() => menu.querySelector('button[data-source]') !== null, 'the split’s source item')
    await userEvent.click(menu.querySelector('button[data-source]') as HTMLElement)
    expect(noticeText(), 'the split’s source view was refused').toBe('view added — source')
    expect(mounted()).toEqual(['lambda-0', 'source', AGAIN, 'asm-0'])
    expect(liveViewCount(), 'the source view was counted as a 65th').toBe(MAX_TREE_LEAVES)
  })

  /**
   * **A CUSTOM WORKSPACE'S MENU HAS NO *RESET PRESET*.** Its switches match no preset, and `app-header.ts`'s
   * `workspaceItems` leaves the item out until one is chosen. For a close that makes no room, the notice names
   * choosing a preset first there, which is what brings the item back.
   */
  it('names choosing a preset first in a custom workspace, whose menu has no reset preset', async () => {
    expect(liveViewCount(), 'precondition: the workspace is at the bound').toBe(MAX_TREE_LEAVES)
    expect(mounted(), 'precondition: four views on screen').toHaveLength(4)
    expect(await resetOffered(), 'precondition: a preset’s menu holds reset preset').toBe(true)
    await userPickInWorkspaceMenu('[data-switch="readout"][data-value="inspector"]')
    expect(workspaceNameText(), 'precondition: the workspace is custom').toBe('custom ▾')
    expect(await resetOffered(), 'a custom workspace’s menu holds reset preset').toBe(false)
    const before = { mounted: mounted(), stored: storedLayoutText() }
    await plusView('λ · program', '+ view’s λ · program')
    await focusInPage('+ view’s λ · program, refused in a custom workspace')
    expect.soft(noticeText()).toBe(full(60, REMEDY_CUSTOM))
    expect.soft(mounted(), 'the refused add changed the views on the page').toEqual(before.mounted)
    expect.soft(storedLayoutText() === before.stored, 'the refused add stored another workspace').toBe(true)
  })

  /**
   * **THE NOTICE'S OWN STEPS, PRESSED AS A USER PRESSES THEM**: a preset, which leaves the menu open with *reset
   * preset* back in it, and then that item. `.click()` on `#reset-preset` reaches the button whether or not a menu
   * holds it, so it could not tell a custom workspace's menu from a preset's.
   */
  it('has room for another once a preset is chosen and reset preset has forgotten the views not on screen, as the notice says', async () => {
    expect(workspaceNameText(), 'precondition: the workspace is custom').toBe('custom ▾')
    await userEvent.click(document.querySelector('#workspace') as HTMLElement)
    await userEvent.click(workspaceMenu().querySelector('[data-preset="explorer"]') as HTMLElement)
    await userEvent.click(workspaceMenu().querySelector('#reset-preset') as HTMLElement)
    expect(mounted(), 'precondition: the reset shows the source beside the TM view').toEqual(['source', 'tm-0'])
    await plusView('λ · program', '+ view’s λ · program')
    expect(mounted(), 'the add after the reset was refused').toHaveLength(3)
    expect(noticeText()).toBe('view added — λ · program')
  })
})
