import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { encodeLink } from '../../src/share-link'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import {
  host,
  pressTab,
  pressToggle,
  resetToFourViews,
  SHELL,
  scrollRange,
  stageTab,
  stateIdle,
  tmStateTable,
  tmViewHost,
  until,
  workspaceNameText,
} from './harness'
import { userPickWorkspace } from './user-event-fixture'

/**
 * A REBUILD OF THE LAYOUT KEEPS WHERE EVERY VIEW WAS SCROLLED TO — the view layouts spec §5.2.
 *
 * `layout-view.ts`'s `renderLayout` and `renderStage` take every view's host off the page and put back the ones they
 * show, which in tiles is every one the tree names and on the Stage the focused view's alone, and an element that
 * leaves the document comes back scrolled to its start. So without a hold, closing ONE view would reset the scroll
 * of every other, and so would a split, `+ view` and a preset. `pane-host.ts` records each scrolled element before a
 * rebuild and puts it back after.
 *
 * **THREE SCROLLERS ARE HELD TO IT, EACH ONE OF A KIND**: the TM view's rule table, a box inside a view, with the
 * active row its keys move; the TM view's host, which is the view's own scroll box, scrolled where the view's tile
 * is shorter than the floors of what it shows; and the source editor, down and sideways, the one box here that holds
 * a `scrollLeft`. The program is `let x = 40; x + 2` with blank lines to make it longer than its view and trailing
 * spaces to make it wider, so every leg is what it is without them.
 *
 * **THE SOURCE VIEW'S HOST IS NOT ONE OF THEM**: its editor takes a share of the view and scrolls inside it (the
 * view layouts spec §11.1), so a long program does not scroll the view, and its header stays where it is.
 *
 * **EVERY CASE PUTS THE THREE WHERE IT STARTS FROM, AND ASSERTS THEY ARE THERE** (`arm`): a case that inherited them
 * from the one before would pass on a page where nothing had been scrolled at all.
 *
 * **AND EVERY CASE STARTS ON THE PAGE THE FILE OPENED ON, WHATEVER THE ONE BEFORE LEFT** (the first `beforeEach`): the
 * program, tiles, all four views and the window's size. The cases close a view, add one, enter the Stage and, in the
 * last, open a link, which replaces the program and the workspace.
 *
 * **THE VIEW THAT IS SCROLLED IS NEVER THE ONE THE GESTURE IS MADE ON**, until the last two cases, which are about a
 * view that is built again and must NOT be given the scroll of the one before it. `view-toggles.test.ts` has the
 * hold for a view a toggle takes off the page, and `follow-kept.test.ts` has it for a box that follows the run.
 */

const PROGRAM = `let x = 40;${'\n'.repeat(60)}x + 2${' '.repeat(400)}`
/** A program a link carries: as long and as wide as `PROGRAM`, so the source view could be scrolled as far under it. */
const LINKED = `let y = 10;${'\n'.repeat(60)}y + 5${' '.repeat(400)}`

const editor = (): HTMLElement => host('source')?.querySelector('.cm-scroller') as HTMLElement

/** The rule table's active row, the one its arrow keys move: an index into the whole table, or -1 for none. */
const activeRow = (): number =>
  Number(/-(\d+)$/.exec(tmStateTable().getAttribute('aria-activedescendant') ?? '')?.[1] ?? -1)
/**
 * Scroll the rule table as a user does — the table follows the run until a `scroll` of the user's reaches it — and
 * put its active row two rows into what it then shows, with the keys.
 *
 * **THE ACTIVE ROW IS WHAT HOLDS THE REBUILD TO ITS ORDER**: positions put back, then the views drawn. A grid keeps
 * its active row among the rows on screen at every draw, so a table drawn at its start and scrolled back afterwards
 * has had it carried to the top of the table and back to the first row in view, which is not the row the user left.
 */
const armTable = async (): Promise<void> => {
  tmStateTable().scrollTop = 120
  tmStateTable().dispatchEvent(new Event('scroll'))
  await until(() => tmStateTable().scrollTop === 120, 'the table to hold its scroll')
  for (let press = 0; press < 2 && activeRow() < 7; press += 1)
    tmStateTable().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  expect(activeRow(), 'precondition: the active row is two rows into the rows in view').toBe(7)
  expect(tmStateTable().scrollTop, 'precondition: the keys did not scroll the table').toBe(120)
}
const armSource = async (): Promise<void> => {
  editor().scrollTop = 120
  editor().scrollLeft = 300
  await until(() => editor().scrollTop === 120 && editor().scrollLeft === 300, 'the source editor to hold its scroll')
}
/** The TM view's own box, where its tile is shorter than the view: a case in tiles alone, since a Stage's is not. */
const armHost = async (): Promise<void> => {
  expect(scrollRange(tmViewHost()), 'precondition: the TM view’s own box scrolls').toBeGreaterThan(40)
  tmViewHost().scrollTop = 40
  await until(() => tmViewHost().scrollTop === 40, 'the TM view to hold its scroll')
}
/** Put the table and the editor where a case starts from. */
const arm = async (): Promise<void> => {
  await armTable()
  await armSource()
}
/** And the TM view's own box before them, for a case that stays in tiles. */
const armTiles = async (): Promise<void> => {
  await armHost()
  await arm()
}
const heldTable = (gesture: string): void => {
  expect(tmStateTable().scrollTop, `${gesture} reset the TM view’s rule table`).toBe(120)
  expect(activeRow(), `${gesture} moved the rule table’s active row`).toBe(7)
}
const heldHost = (gesture: string): void => {
  expect(tmViewHost().scrollTop, `${gesture} reset the TM view’s own scroll box`).toBe(40)
}
const heldSource = (gesture: string): void => {
  expect(editor().scrollTop, `${gesture} reset the source editor`).toBe(120)
  expect(editor().scrollLeft, `${gesture} reset the source editor sideways`).toBe(300)
}
const held = (gesture: string): void => {
  heldTable(gesture)
  heldSource(gesture)
}
const heldTiles = (gesture: string): void => {
  heldHost(gesture)
  held(gesture)
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
    await until(stateIdle, 'the compile')
    if (!workspaceNameText().includes('Explorer')) {
      document.querySelector<HTMLElement>('#workspace')?.click()
      document.querySelector<HTMLElement>('#workspace-menu [data-preset="explorer"]')?.click()
      document.querySelector<HTMLElement>('#workspace-menu')?.hidePopover()
    }
    await resetToFourViews()
    await until(() => host('tm-0')?.querySelector('.state-table .state-row') != null, 'the rule table to draw')
    expect(scrollRange(tmStateTable()), 'precondition: the rule table scrolls').toBeGreaterThan(200)
    expect(scrollRange(editor()), 'precondition: the source editor scrolls').toBeGreaterThan(200)
    expect(editor().scrollWidth - editor().clientWidth, 'precondition: the editor scrolls sideways').toBeGreaterThan(
      400,
    )
  })

  it('is kept when another view is closed', async () => {
    await armTiles()
    await userEvent.click(host('asm-0')?.querySelector('button.view-close') as HTMLElement)
    expect(host('asm-0'), 'the asm view is still on the page').toBeNull()
    heldTiles('closing the asm view')
  })

  it('is kept when a view is added', async () => {
    await armTiles()
    const before = document.querySelectorAll('#views [data-leaf]').length
    await userEvent.click(document.querySelector('#new-view') as HTMLElement)
    await userEvent.click(document.querySelector('#new-view-menu button') as HTMLElement)
    expect(document.querySelectorAll('#views [data-leaf]').length, '+ view added nothing').toBe(before + 1)
    heldTiles('adding a view')
  })

  // THE TABLE AND THE EDITOR ALONE: the Debugger preset draws the views narrower and shorter, and the TM view's own
  // box then has 34 px to scroll where it had more than 40, so a position it held would be clamped, not kept.
  it('is kept when the preset changes how the views are drawn, and when it changes back', async () => {
    await arm()
    await userPickWorkspace('[data-preset="debugger"]')
    expect(workspaceNameText(), 'the Debugger preset was not chosen').toContain('Debugger')
    expect(document.querySelector<HTMLElement>('#step-bar')?.hidden, 'the Debugger preset drew no step bar').toBe(false)
    held('the Debugger preset')
    await userPickWorkspace('[data-preset="explorer"]')
    expect(workspaceNameText(), 'the Explorer preset was not chosen').toContain('Explorer')
    expect(document.querySelector<HTMLElement>('#step-bar')?.hidden, 'the Explorer preset kept the step bar').toBe(true)
    held('the Explorer preset')
  })

  /**
   * THE STAGE IS THE OTHER RENDERER (`layout-view.ts`'s `renderStage`), and it puts one view on the page: each view
   * is given its scroll back when its own tab is selected, however many rebuilds it sat out.
   */
  it('is kept when the Stage is entered, by each view when its tab is selected', async () => {
    await arm()
    await userPickWorkspace('[data-preset="stage"]')
    expect(document.querySelectorAll('#views [role="tab"]').length, 'the Stage drew no tabs').toBeGreaterThan(1)
    await pressTab('tm-0')
    expect(host('source'), 'the Stage has two views on the page').toBeNull()
    heldTable('entering the Stage')
    await pressTab('source')
    expect(host('tm-0'), 'the Stage has two views on the page').toBeNull()
    heldSource('entering the Stage')
  })

  it('is kept when a Stage tab is left and selected again, and when tiles come back', async () => {
    await userPickWorkspace('[data-preset="stage"]')
    expect(stageTab('tm-0'), 'precondition: the Stage is drawn').not.toBeNull()
    await pressTab('tm-0')
    await armTable()
    await pressTab('source')
    await armSource()
    await pressTab('tm-0')
    heldTable('a Stage tab left and selected again')
    await pressTab('source')
    heldSource('a Stage tab left and selected again')
    await userPickWorkspace('[data-preset="explorer"]')
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
   * fail with the rule off: a title is in its view's header, which scrolls with the view, and a press on it scrolls
   * it into view first; and *reset preset* builds only the TM view again.
   */
  describe('a view that is built again', () => {
    const asm = (): HTMLElement => host('asm-0') as HTMLElement

    // AFTER THE HOOK ABOVE, which has put the page in tiles and the window back: three views in a short window.
    beforeEach(async () => {
      await page.viewport(1280, 500)
      await userPickWorkspace('#reset-preset')
      await until(() => host('lambda-0') === null && host('tm-0') !== null, 'the default views')
      await pressToggle('asm')
      await until(() => host('asm-0') !== null && scrollRange(asm()) > 60, 'an asm view taller than its tile')
    })

    /**
     * *RESET PRESET* CLOSES EVERY VIEW THE DEFAULT DOES WITHOUT, and a toggle pressed next shows a new one in the host
     * the closed one had. A toggle leaves the focus where it was, so nothing but the rule under test puts the new view
     * at its top. **CLOSED BY THE RESET, NOT BY ITS `✕`**: the `✕` is at the top of its view, out of sight in one
     * scrolled 60 px, and a click on it scrolls it into view before it lands, so a view closed that way would be at
     * its top already.
     */
    it('starts at the top when reset preset closed it and its toggle shows a new one', async () => {
      asm().scrollTop = 60
      expect(asm().scrollTop, 'precondition: the asm view’s own box is scrolled').toBe(60)
      const closed = asm()
      await userPickWorkspace('#reset-preset')
      expect(host('asm-0'), 'the asm view is still on the page').toBeNull()
      await pressToggle('asm')
      expect(host('asm-0'), 'the new view is not in the host the closed one had').toBe(closed)
      expect(scrollRange(asm()), 'precondition: the new view could be scrolled').toBeGreaterThan(60)
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
      expect(scrollRange(editor()), 'precondition: the link’s program could be scrolled as far').toBeGreaterThan(200)
      expect(editor().scrollWidth - editor().clientWidth, 'precondition: and as far sideways').toBeGreaterThan(400)
      // ONE ASSERTION ON BOTH, so a failure shows each and neither hides behind the other.
      expect(
        { down: editor().scrollTop, sideways: editor().scrollLeft },
        'the link’s program opened where the one before it was scrolled to',
      ).toEqual({ down: 0, sideways: 0 })
    })
  })
})
