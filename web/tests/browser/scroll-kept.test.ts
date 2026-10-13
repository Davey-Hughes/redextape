import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { encodeLink } from '../../src/share-link'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { focusInPage, resetToFourViews, SHELL, until } from './harness'

/**
 * A REBUILD OF THE LAYOUT KEEPS WHERE EVERY VIEW WAS SCROLLED TO — the view layouts spec §5.2.
 *
 * `layout-view.ts`'s `renderLayout` and `renderStage` take every view's host off the page and put back the ones they
 * show, which in tiles is every one the tree names and on the Stage the focused view's alone, and an element that
 * leaves the document comes back scrolled to its start. So closing ONE view reset the scroll of
 * every other, and so did a split, `+ view` and a preset. `pane-host.ts` records each scrolled element before a
 * rebuild and puts it back after.
 *
 * **THREE SCROLLERS ARE HELD TO IT, EACH ONE OF A KIND**: the TM view's rule table, a box inside a view, with the
 * active row its keys move; the source view's host, which is the view's own scroll box and the only thing that
 * scrolls a long program; and the source editor sideways, the one position here that is a `scrollLeft`. The program
 * is `let x = 40; x + 2` with blank lines to make it longer than its view and trailing spaces to make it wider, so
 * every leg is what it is without them.
 *
 * **EVERY CASE PUTS THE THREE WHERE IT STARTS FROM, AND ASSERTS THEY ARE THERE** (`arm`): a case that inherited them
 * from the one before would pass on a page where nothing had been scrolled at all.
 *
 * **AND EVERY CASE STARTS ON THE PAGE THE FILE OPENED ON, WHATEVER THE ONE BEFORE LEFT** (the first `beforeEach`): the
 * program, tiles, all four views and the window's size. The cases close a view, add one, enter the Stage and, in the
 * last, open a link, which replaces the program and the workspace; each ran on what the ones before it had left, the
 * case of a Stage tab left and selected again failed alone, and nothing put the link's program back (2026-10-12).
 *
 * **THE VIEW THAT IS SCROLLED IS NEVER THE ONE THE GESTURE IS MADE ON**, until the last two cases, which are about a
 * view that is built again and must NOT be given the scroll of the one before it. `view-toggles.test.ts` has the
 * hold for a view a toggle takes off the page, and `follow-kept.test.ts` has it for a box that follows the run.
 */

const PROGRAM = `let x = 40;${'\n'.repeat(60)}x + 2${' '.repeat(400)}`
/** A program a link carries: as long and as wide as `PROGRAM`, so the source view could be scrolled as far under it. */
const LINKED = `let y = 10;${'\n'.repeat(60)}y + 5${' '.repeat(400)}`

const host = (leaf: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${leaf}"]:not([role="tab"])`)
const table = (): HTMLElement => host('tm-0')?.querySelector('.state-table') as HTMLElement
const source = (): HTMLElement => host('source') as HTMLElement
const editor = (): HTMLElement => host('source')?.querySelector('.cm-scroller') as HTMLElement
const tab = (leaf: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`) as HTMLElement
const toggle = (kind: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#views-shown button[data-shows="${kind}"]`) as HTMLElement
const workspace = (): string => document.querySelector('#workspace')?.textContent ?? ''
const pick = async (sel: string): Promise<void> => {
  await userEvent.click(document.querySelector('#workspace') as HTMLElement)
  await userEvent.click(document.querySelector(`#workspace-menu ${sel}`) as HTMLElement)
  const menu = document.querySelector<HTMLElement>('#workspace-menu')
  if (menu?.matches(':popover-open')) menu.hidePopover()
}
/** A press on a toggle with the pointer, after which the focus is somewhere in the page (spec §14 item 19). */
const pressToggle = async (kind: string): Promise<void> => {
  await userEvent.click(toggle(kind))
  await focusInPage(`a press on the ${kind} toggle`)
}
/** And one on a Stage tab. */
const pressTab = async (leaf: string): Promise<void> => {
  await userEvent.click(tab(leaf))
  await focusInPage(`a press on the Stage tab of ${leaf}`)
}
/** How far `el` can scroll down: a box that cannot is at 0 whatever it was given. */
const range = (el: HTMLElement): number => el.scrollHeight - el.clientHeight

/** The rule table's active row, the one its arrow keys move: an index into the whole table, or -1 for none. */
const activeRow = (): number => Number(/-(\d+)$/.exec(table().getAttribute('aria-activedescendant') ?? '')?.[1] ?? -1)
/**
 * Scroll the rule table as a user does — the table follows the run until a `scroll` of the user's reaches it — and
 * put its active row two rows into what it then shows, with the keys.
 *
 * **THE ACTIVE ROW IS WHAT HOLDS THE REBUILD TO ITS ORDER**: positions put back, then the views drawn. A grid keeps
 * its active row among the rows on screen at every draw, so a table drawn at its start and scrolled back afterwards
 * has had it carried to the top of the table and back to the first row in view, which is not the row the user left.
 */
const armTable = async (): Promise<void> => {
  table().scrollTop = 120
  table().dispatchEvent(new Event('scroll'))
  await until(() => table().scrollTop === 120, 'the table to hold its scroll')
  for (let press = 0; press < 2 && activeRow() < 7; press += 1)
    table().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  expect(activeRow(), 'precondition: the active row is two rows into the rows in view').toBe(7)
  expect(table().scrollTop, 'precondition: the keys did not scroll the table').toBe(120)
}
const armSource = async (): Promise<void> => {
  source().scrollTop = 120
  editor().scrollLeft = 300
  await until(() => source().scrollTop === 120 && editor().scrollLeft === 300, 'the source view to hold its scroll')
}
/** Put the three scrollers where a case starts from. */
const arm = async (): Promise<void> => {
  await armTable()
  await armSource()
}
const heldTable = (gesture: string): void => {
  expect(table().scrollTop, `${gesture} reset the TM view’s rule table`).toBe(120)
  expect(activeRow(), `${gesture} moved the rule table’s active row`).toBe(7)
}
const heldSource = (gesture: string): void => {
  expect(source().scrollTop, `${gesture} reset the source view’s own scroll box`).toBe(120)
  expect(editor().scrollLeft, `${gesture} reset the source editor sideways`).toBe(300)
}
const held = (gesture: string): void => {
  heldTable(gesture)
  heldSource(gesture)
}

describe('a view’s scroll position, across a rebuild made by another view', () => {
  let view: EditorView

  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  // THE PAGE A CASE STARTS ON: an arrangement, so the preset is chosen with `.click()`, as `resetToFourViews` presses.
  beforeEach(async () => {
    await page.viewport(1280, 896)
    if (view.state.doc.toString() !== PROGRAM)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: PROGRAM } })
    // `running` FROM THE DISPATCH ITSELF (`compile.ts`'s `createCompile`), so this is the compile of what it wrote.
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the compile')
    if (!workspace().includes('Explorer')) {
      document.querySelector<HTMLElement>('#workspace')?.click()
      document.querySelector<HTMLElement>('#workspace-menu [data-preset="explorer"]')?.click()
      document.querySelector<HTMLElement>('#workspace-menu')?.hidePopover()
    }
    await resetToFourViews()
    await until(() => host('tm-0')?.querySelector('.state-table .state-row') != null, 'the rule table to draw')
    expect(range(table()), 'precondition: the rule table scrolls').toBeGreaterThan(200)
    expect(range(source()), 'precondition: the source view’s own box scrolls').toBeGreaterThan(200)
    expect(editor().scrollWidth - editor().clientWidth, 'precondition: the editor scrolls sideways').toBeGreaterThan(
      400,
    )
  })

  it('is kept when another view is closed', async () => {
    await arm()
    await userEvent.click(host('asm-0')?.querySelector('button.view-close') as HTMLElement)
    expect(host('asm-0'), 'the asm view is still on the page').toBeNull()
    held('closing the asm view')
  })

  it('is kept when a view is added', async () => {
    await arm()
    const before = document.querySelectorAll('#views [data-leaf]').length
    await userEvent.click(document.querySelector('#new-view') as HTMLElement)
    await userEvent.click(document.querySelector('#new-view-menu button') as HTMLElement)
    expect(document.querySelectorAll('#views [data-leaf]').length, '+ view added nothing').toBe(before + 1)
    held('adding a view')
  })

  it('is kept when the preset changes how the views are drawn, and when it changes back', async () => {
    await arm()
    await pick('[data-preset="debugger"]')
    expect(workspace(), 'the Debugger preset was not chosen').toContain('Debugger')
    expect(document.querySelector<HTMLElement>('#step-bar')?.hidden, 'the Debugger preset drew no step bar').toBe(false)
    held('the Debugger preset')
    await pick('[data-preset="explorer"]')
    expect(workspace(), 'the Explorer preset was not chosen').toContain('Explorer')
    expect(document.querySelector<HTMLElement>('#step-bar')?.hidden, 'the Explorer preset kept the step bar').toBe(true)
    held('the Explorer preset')
  })

  /**
   * THE STAGE IS THE OTHER RENDERER (`layout-view.ts`'s `renderStage`), and it puts one view on the page: each view
   * is given its scroll back when its own tab is selected, however many rebuilds it sat out.
   */
  it('is kept when the Stage is entered, by each view when its tab is selected', async () => {
    await arm()
    await pick('[data-preset="stage"]')
    expect(document.querySelectorAll('#views [role="tab"]').length, 'the Stage drew no tabs').toBeGreaterThan(1)
    await pressTab('tm-0')
    expect(host('source'), 'the Stage has two views on the page').toBeNull()
    heldTable('entering the Stage')
    await pressTab('source')
    expect(host('tm-0'), 'the Stage has two views on the page').toBeNull()
    heldSource('entering the Stage')
  })

  it('is kept when a Stage tab is left and selected again, and when tiles come back', async () => {
    await pick('[data-preset="stage"]')
    expect(tab('tm-0'), 'precondition: the Stage is drawn').not.toBeNull()
    await pressTab('tm-0')
    await armTable()
    await pressTab('source')
    await armSource()
    await pressTab('tm-0')
    heldTable('a Stage tab left and selected again')
    await pressTab('source')
    heldSource('a Stage tab left and selected again')
    await pick('[data-preset="explorer"]')
    expect(document.querySelector('#views [role="tab"]'), 'the Stage is still drawn').toBeNull()
    held('leaving the Stage')
  })

  /**
   * **A VIEW THAT IS BUILT AGAIN IS A NEW VIEW, AND STARTS AT THE TOP.** Its host is the one the view before it had,
   * and that host still has the old view's scroll, or the record of it. In a window 500 px tall with three views, where
   * an asm view is taller than its tile from the moment it is built: the claim is that the host is at 0 though it
   * could be elsewhere, which each case asserts beside it.
   *
   * **A PICK IN A VIEW'S TITLE AND *RESET PRESET* BUILD A VIEW AGAIN TOO, AND HAVE NO CASE HERE**, since neither can
   * fail with the rule off. A title is in its view's header, which scrolls with the view, and a press on it scrolls
   * it into view first: measured (2026-10-12), an asm view at 60 px was at 0 at the `pointerdown` of a click on its
   * title. And *reset preset* builds only the TM view again: measured the same day with `fresh` off, an asm view at
   * 60 px in the TM view's leaf was at 0 once a reset pressed with the pointer had built a TM view there.
   */
  describe('a view that is built again', () => {
    const asm = (): HTMLElement => host('asm-0') as HTMLElement

    // AFTER THE HOOK ABOVE, which has put the page in tiles and the window back: three views in a short window.
    beforeEach(async () => {
      await page.viewport(1280, 500)
      await pick('#reset-preset')
      await until(() => host('lambda-0') === null && host('tm-0') !== null, 'the default views')
      await pressToggle('asm')
      await until(() => host('asm-0') !== null && range(asm()) > 60, 'an asm view taller than its tile')
    })

    /**
     * *RESET PRESET* CLOSES EVERY VIEW THE DEFAULT DOES WITHOUT, and a toggle pressed next shows a new one in the host
     * the closed one had. A toggle leaves the focus where it was, so nothing but the rule under test puts the new view
     * at its top. **CLOSED BY THE RESET, NOT BY ITS `✕`**: the `✕` is at the top of its view, out of sight in one
     * scrolled 60 px, and a click on it scrolls it into view before it lands — measured, the host was at 0 at the
     * click's `pointerdown` — so a view closed that way was at its top already.
     */
    it('starts at the top when reset preset closed it and its toggle shows a new one', async () => {
      asm().scrollTop = 60
      expect(asm().scrollTop, 'precondition: the asm view’s own box is scrolled').toBe(60)
      const closed = asm()
      await pick('#reset-preset')
      expect(host('asm-0'), 'the asm view is still on the page').toBeNull()
      await pressToggle('asm')
      expect(host('asm-0'), 'the new view is not in the host the closed one had').toBe(closed)
      expect(range(asm()), 'precondition: the new view could be scrolled').toBeGreaterThan(60)
      expect(asm().scrollTop, 'the new view was given the closed one’s scroll').toBe(0)
    })

    /** An opened link builds every view again and gives the source view another program: nothing is held. */
    it('opens a link’s program at its top', async () => {
      await armSource()
      location.hash = await encodeLink({
        program: LINKED,
        encoding: 'unary',
        workspace: serializeWorkspace(defaultWorkspace('wide')),
        positions: {},
      })
      await until(
        () => document.querySelector('#notice .notice-text')?.textContent === 'opened a shared link',
        'the link to open',
      )
      expect(range(source()), 'precondition: the link’s program could be scrolled as far').toBeGreaterThan(200)
      expect(editor().scrollWidth - editor().clientWidth, 'precondition: and as far sideways').toBeGreaterThan(400)
      // ONE ASSERTION ON BOTH, so a failure shows each and neither hides behind the other.
      expect(
        { down: source().scrollTop, sideways: editor().scrollLeft },
        'the link’s program opened where the one before it was scrolled to',
      ).toEqual({ down: 0, sideways: 0 })
    })
  })
})
