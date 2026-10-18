import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, MAX_TREE_LEAVES } from '../../src/layout'
import { serializeWorkspace } from '../../src/workspace'
import {
  focusInPage,
  fourViewWorkspace,
  liveViewCount,
  mounted,
  noticeText,
  pressed,
  rowOfLeaves,
  SHELL,
  stateIdle,
  storedLayoutText,
  toggle,
  until,
  workspaceMenu,
  workspaceNameText,
} from './harness'
import { resetOffered, userPickInWorkspaceMenu } from './user-event-fixture'

/**
 * **A SWITCH IS REFUSED WHERE ITS VIEWS WOULD TAKE THE LIVE ONES PAST 64** — the view layouts spec §4.5 and §5.6. A
 * combination's first visit shows its default arrangement, whose leaves are the default ids, and the arrangement left
 * is remembered, so its views stay live. Where the workspace does not hold those ids already, the switch adds views:
 * it is held to the bound as `+ view` is, and a refused one changes nothing.
 *
 * The page opens on a stored tree of 62 λ views, `pane-1` to `pane-62`, with no source view on screen and the source
 * view alone remembered: 63 live views. **THE CASES RUN IN ORDER ON ONE PAGE**, each from the state the one before
 * left, and each asserts that state first:
 *
 * 1. the asm toggle asks for a λ view beside an asm view, whose default needs `lambda-0` and `asm-0`: 65, refused;
 * 2. the source toggle asks for the source beside a λ view, whose default needs `lambda-0` alone: 64, entered;
 * 3. the TM toggle then asks for one view more, `tm-0`: 65, refused.
 *
 * **BOTH SIDES OF THE BOUND**: the switch to 64 goes through and the switches to 65 do not. With a switch to 66 as the
 * only case, the bound passed a view higher (measured 2026-10-12: `> MAX_TREE_LEAVES + 1` in `main.ts`'s `switchTo`).
 *
 * **THE NOTICE SAYS THE THREE NUMBERS.** A switch can be refused short of the bound, as the first one here is at 63,
 * and it was told "the workspace holds 64 views" (measured 2026-10-12).
 *
 * `live-views-bound.test.ts` holds the bound for `+ view`. Storage is read once, at the mount, so each stores its
 * own workspace before it and each is a file.
 */

const ROW = rowOfLeaves(62)
const IDS = Array.from({ length: 62 }, (_, i) => `pane-${i + 1}`)
/** What makes room, as the notice says it in a workspace that is a preset; a custom one has a step before it. */
const RESET = 'reset preset makes room'
const RESET_CUSTOM = 'choose a preset, then reset preset makes room'
const refusedAt = (shows: string, from: number, to: number, remedy = RESET): string =>
  `showing ${shows} would take the workspace from ${from} views to ${to}, and it can keep 64 — ${remedy}`

beforeAll(async () => {
  await page.viewport(1280, 896)
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({
      ...fourViewWorkspace(),
      tree: ROW,
      focused: 'pane-1',
      arrangements: { source: { kind: 'leaf', id: 'source', pane: 'source' } },
    }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
})

describe('a switch, with 62 λ views on screen and the source view remembered', () => {
  /**
   * **THE NOTICE AND WHAT IS LEFT AS IT WAS ARE EACH ASSERTED SOFT**, so a switch that went through is reported in
   * each: by the line, by the views and the toggles it left, and by the workspace it stored. The stored workspace is
   * compared whole and reported as a yes or a no, since two workspaces of 64 views are not a diff anyone reads.
   */
  it('is refused where it would make 65 of 63, in words that say 63, and changes nothing', async () => {
    // A STORED WORKSPACE THE LOADER REFUSED WOULD HAVE OPENED ON THE DEFAULT, the source beside the TM view.
    expect(mounted(), 'precondition: the page opened on the stored 62 views').toEqual(IDS)
    expect(pressed(), 'precondition: the λ toggle alone is pressed').toEqual(['lambda'])
    expect(liveViewCount(), 'precondition: one short of the bound').toBe(MAX_TREE_LEAVES - 1)

    const before = { mounted: mounted(), pressed: pressed(), stored: storedLayoutText() }
    await userEvent.click(toggle('asm'))
    await focusInPage('a press on the asm toggle, whose switch is refused')
    expect
      .soft(noticeText(), 'the switch was not refused, or not in words true of 63')
      .toBe(refusedAt('asm and λ', 63, 65))
    expect.soft(pressed(), 'the refused switch moved the toggles').toEqual(before.pressed)
    expect.soft(mounted(), 'the refused switch changed the views on the page').toEqual(before.mounted)
    expect.soft(storedLayoutText() === before.stored, 'the refused switch stored another workspace').toBe(true)
  })

  it('is entered where it makes exactly 64', async () => {
    expect(liveViewCount(), 'precondition: one short of the bound').toBe(MAX_TREE_LEAVES - 1)
    await userEvent.click(toggle('source'))
    expect(mounted(), 'the switch to 64 live views was refused').toEqual(['source', 'lambda-0'])
    expect(pressed()).toEqual(['source', 'lambda'])
    expect(liveViewCount()).toBe(MAX_TREE_LEAVES)
  })

  it('is refused where it would make 65 of 64, and changes nothing', async () => {
    expect(liveViewCount(), 'precondition: the live views are exactly the bound').toBe(MAX_TREE_LEAVES)
    const before = { mounted: mounted(), pressed: pressed(), stored: storedLayoutText() }
    await userEvent.click(toggle('tm'))
    await focusInPage('a press on the TM toggle, whose switch is refused')
    expect.soft(noticeText(), 'the switch was not refused').toBe(refusedAt('source, λ and TM', 64, 65))
    expect.soft(pressed(), 'the refused switch moved the toggles').toEqual(before.pressed)
    expect.soft(mounted(), 'the refused switch changed the views on the page').toEqual(before.mounted)
    expect.soft(storedLayoutText() === before.stored, 'the refused switch stored another workspace').toBe(true)
  })

  /**
   * **A CUSTOM WORKSPACE'S MENU HAS NO *RESET PRESET*.** Its switches match no preset, and `app-header.ts`'s
   * `workspaceItems` leaves the item out until one is chosen. The notice named it there all the same, as the way to
   * make room; it names choosing a preset first now, which is what brings the item back.
   */
  it('names choosing a preset first in a custom workspace, whose menu has no reset preset', async () => {
    expect(liveViewCount(), 'precondition: the live views are exactly the bound').toBe(MAX_TREE_LEAVES)
    expect(await resetOffered(), 'precondition: a preset’s menu holds reset preset').toBe(true)
    await userPickInWorkspaceMenu('[data-switch="readout"][data-value="inspector"]')
    expect(workspaceNameText(), 'precondition: the workspace is custom').toBe('custom ▾')
    expect(await resetOffered(), 'a custom workspace’s menu holds reset preset').toBe(false)
    const before = { mounted: mounted(), pressed: pressed(), stored: storedLayoutText() }
    await userEvent.click(toggle('tm'))
    await focusInPage('a press on the TM toggle, whose switch is refused in a custom workspace')
    expect.soft(noticeText()).toBe(refusedAt('source, λ and TM', 64, 65, RESET_CUSTOM))
    expect.soft(pressed(), 'the refused switch moved the toggles').toEqual(before.pressed)
    expect.soft(mounted(), 'the refused switch changed the views on the page').toEqual(before.mounted)
    expect.soft(storedLayoutText() === before.stored, 'the refused switch stored another workspace').toBe(true)
  })

  /**
   * **THE NOTICE'S OWN STEPS, PRESSED AS A USER PRESSES THEM**: a preset, which leaves the menu open with *reset
   * preset* back in it, and then that item. `.click()` on `#reset-preset` reaches the button whether or not a menu
   * holds it, so it could not tell a custom workspace's menu from a preset's.
   */
  it('is entered once a preset is chosen and reset preset has forgotten the views not on screen, as the notice says', async () => {
    expect(workspaceNameText(), 'precondition: the workspace is custom').toBe('custom ▾')
    await userEvent.click(document.querySelector('#workspace') as HTMLElement)
    await userEvent.click(workspaceMenu().querySelector('[data-preset="explorer"]') as HTMLElement)
    await userEvent.click(workspaceMenu().querySelector('#reset-preset') as HTMLElement)
    expect(mounted(), 'precondition: the reset shows the source beside the TM view').toEqual(['source', 'tm-0'])
    await userEvent.click(toggle('lambda'))
    expect(mounted(), 'the switch after the reset was refused').toHaveLength(3)
    expect(pressed()).toEqual(['source', 'lambda', 'tm'])
  })
})
