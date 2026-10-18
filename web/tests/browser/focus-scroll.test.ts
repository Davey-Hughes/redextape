import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { encodeLink } from '../../src/share-link'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import {
  drawn,
  firstButton,
  frames,
  host,
  mounted,
  notice,
  PREFIX,
  resetToFirstLoad,
  SHELL,
  scrollRange,
  showWideDefault,
  sourcePane,
  sourceScroller,
  stateIdle,
  tmViewHost,
  toggle,
  until,
} from './harness'

/**
 * WHERE A VIEW IS SCROLLED TO ONCE A GESTURE HAS GIVEN IT THE FOCUS — the view layouts spec §4.5 and §5.2, and
 * `pane-host.ts`'s `moveFocus`: a focus the app moves as the consequence of a gesture scrolls nothing where the
 * gesture was a pointer's, and brings what it focused into sight where it was a key's.
 *
 * **A VIEW'S FIRST CONTROL IS IN ITS HEADER, WHICH SCROLLS WITH THE VIEW WHERE THE VIEW'S OWN BOX SCROLLS.** There the
 * two halves cannot both keep a scrolled view where it was: a pointer press leaves it there with its first control
 * out of sight and no ring drawn on it, and a key press brings the control into sight, which for a control in the
 * header is the view at its top. Each case says which half it is.
 *
 * **THE SOURCE VIEW'S OWN BOX DOES NOT SCROLL A LONG PROGRAM ANY LONGER** (the view layouts spec §11.1): its editor
 * takes a share of the view and scrolls inside it, under a header that stays put. So a focus given to the source
 * view's first control is in sight wherever the editor is scrolled to, and both halves leave the editor where it
 * was; the key's half is held to moving a view by the TM view, in a window short enough that its own box scrolls.
 *
 * **ON THE VIEWS A VISITOR GETS, NOT THE FOUR `setup.ts` STORES**: the source beside the TM view, and all four as two
 * columns. In both the source view is the neighbour a `✕` gives the focus to. On the stored four, in two rows, the
 * view `scroll-kept.test.ts` closes has the λ view for its neighbour, and that file passed while a `✕` beside the
 * source view put the source view at 0.
 *
 * `scroll-kept.test.ts` holds a scroll position across a rebuild made from ANOTHER view; this file holds it for the
 * view the rebuild's focus lands in.
 */

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.removeItem(LAYOUT_STORAGE_KEY)

const PROGRAM = `let x = 40;${'\n'.repeat(60)}x + 2`
/** A program a link carries, as long as `PROGRAM`. */
const LINKED = `let y = 10;${'\n'.repeat(60)}y + 5`

let view: EditorView

/** What scrolls `leaf`'s content: the editor's box in the source view, and the view's own box in any other. */
const scroller = (leaf: string): HTMLElement => (leaf === 'source' ? sourceScroller() : (host(leaf) as HTMLElement))

/** Whether all of `inner` shows in the box `leaf`'s view draws in: between its top and the bottom of what it shows. */
const inSight = (inner: { top: number; bottom: number }, leaf: string): boolean => {
  const box = (host(leaf) as HTMLElement).getBoundingClientRect()
  return inner.top >= box.top - 0.5 && inner.bottom <= box.top + (host(leaf) as HTMLElement).clientHeight + 0.5
}
/** Where the source editor's caret is drawn. */
const caret = (): { top: number; bottom: number } => {
  const at = view.coordsAtPos(view.state.selection.main.head)
  if (at === null) throw new Error('the caret has no place on the page')
  return at
}

/** The focus is on `leaf`'s first control, a frame on as well as now, and not on `<body>`. */
async function focusedOn(leaf: string, what: string): Promise<HTMLElement> {
  expect(document.activeElement, `${what}: the focus is not on the ${leaf} view’s first control`).toBe(
    firstButton(leaf),
  )
  await frames()
  expect(document.activeElement, `${what}: two frames on`).toBe(firstButton(leaf))
  return firstButton(leaf)
}

/** Scroll `leaf`'s scroller to `top`, and assert it is there. */
async function scrolled(leaf: string, top: number): Promise<void> {
  expect(scrollRange(scroller(leaf)), `precondition: the ${leaf} view scrolls past ${top}`).toBeGreaterThan(top)
  scroller(leaf).scrollTop = top
  await until(() => scroller(leaf).scrollTop === top, `the ${leaf} view to hold its scroll`)
}

/** Whether all of `inner` shows in the source editor's box. */
const inEditor = (inner: { top: number; bottom: number }): boolean => {
  const box = sourceScroller().getBoundingClientRect()
  return inner.top >= box.top - 0.5 && inner.bottom <= box.top + sourceScroller().clientHeight + 0.5
}

/** The prefix, then `key`. */
async function viewKey(key: string): Promise<void> {
  await userEvent.keyboard(PREFIX)
  expect((document.querySelector('#view-keys') as HTMLElement).hidden, 'the prefix did not arm the mode').toBe(false)
  await userEvent.keyboard(key)
}

/** Put the caret on a line of the source editor drawn `down` px or more below its view's top, with a real click. */
async function caretAt(down: number): Promise<void> {
  const top = sourcePane().getBoundingClientRect().top
  const line = [...sourcePane().querySelectorAll<HTMLElement>('.cm-line')].find(
    (l) => l.getBoundingClientRect().top >= top + down,
  )
  if (line === undefined) throw new Error(`no line is drawn ${down} px down the source view`)
  await userEvent.click(line)
  await until(() => view.hasFocus, 'the source editor to take the focus')
}

describe('the scroll of the view a gesture gives the focus to', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: PROGRAM } })
    await until(stateIdle, 'the first compile')
    await until(() => host('tm-0')?.querySelector('.state-table .state-row') != null, 'the rule table to draw')
    expect(drawn(), 'precondition: the page opened on the first load’s views').toBe('row[50](source tm-0)')
  })

  afterEach(async () => {
    if (!(document.querySelector('#view-keys') as HTMLElement).hidden) await userEvent.keyboard('{Escape}')
    await page.viewport(1280, 896)
  })

  describe('on the first load’s two views', () => {
    /** THE POINTER'S HALF. The `✕` is the TM view's and the view that takes the focus is the source view. */
    it('is kept when the TM view’s ✕ is pressed with the pointer, and no ring is drawn', async () => {
      await resetToFirstLoad()
      await scrolled('source', 120)
      await userEvent.click(tmViewHost().querySelector('button.view-close') as HTMLElement)
      expect(mounted()).toEqual(['source'])
      const focused = await focusedOn('source', 'after the ✕')
      expect(focused.matches(':focus-visible'), 'a pointer press drew a focus ring').toBe(false)
      expect(sourceScroller().scrollTop, 'the ✕ on the TM view reset the source editor').toBe(120)
    })

    /** The same, with the view's `⋯` menu open when the `✕` is pressed: the press closes the menu and lands. */
    it('is kept when the ✕ is pressed with the view’s ⋯ menu open', async () => {
      await resetToFirstLoad()
      await scrolled('source', 120)
      const more = tmViewHost().querySelector('button.view-more') as HTMLElement
      await userEvent.click(more)
      expect(more.getAttribute('aria-expanded'), 'precondition: the ⋯ menu is open').toBe('true')
      await userEvent.click(tmViewHost().querySelector('button.view-close') as HTMLElement)
      expect(mounted()).toEqual(['source'])
      const focused = await focusedOn('source', 'after the ✕')
      expect(focused.matches(':focus-visible')).toBe(false)
      expect(sourceScroller().scrollTop).toBe(120)
    })

    /**
     * THE KEY'S HALF, BY THE ROAD A KEYBOARD USER TAKES TO A `✕`: `Tab` from the view's `⋯`, then `Enter`. The focus
     * is on the source view's first control with its ring drawn, and it has to be in sight.
     *
     * **THE EDITOR STAYS WHERE IT WAS, SINCE THE CONTROL IS IN SIGHT ALREADY**: the source view's header does not
     * scroll with its editor. The view at its top was the rule's outcome while the header did.
     */
    it('shows the focused control and keeps the editor when the ✕ is pressed with Enter', async () => {
      await resetToFirstLoad()
      await scrolled('source', 120)
      ;(tmViewHost().querySelector('button.view-more') as HTMLElement).focus()
      await userEvent.keyboard('{Tab}')
      expect(document.activeElement, 'precondition: Tab from ⋯ reaches the ✕').toBe(
        tmViewHost().querySelector('button.view-close'),
      )
      await userEvent.keyboard('{Enter}')
      expect(mounted()).toEqual(['source'])
      const focused = await focusedOn('source', 'after Enter on the ✕')
      expect(focused.matches(':focus-visible'), 'a key press drew no focus ring').toBe(true)
      expect(inSight(focused.getBoundingClientRect(), 'source'), 'the focused control is out of sight').toBe(true)
      expect(sourceScroller().scrollTop, 'a focus that was in sight already moved the source editor').toBe(120)
    })

    /**
     * THE KEY'S HALF WHERE IT HAS TO MOVE A VIEW: in a window 420 px tall the TM view is taller than its tile, its
     * own box scrolls, and its header scrolls with it. `Enter` on the source view's `✕` gives the TM view the focus,
     * on its first control, which is in its header.
     *
     * **THE TM VIEW IS NEAR ITS TOP AFTERWARDS, AND THAT IS THE RULE, NOT A LOSS IT MISSED**: the control is in the
     * view's header, 3 px under the view's top, so the view is scrolled by that and no more (measured 2026-10-12).
     * What is held is that the control is in sight where it was not, and that the view moved up for it.
     */
    it('gives way to the focused control when the ✕ beside a view whose own box scrolls is pressed with Enter', async () => {
      await resetToFirstLoad()
      await page.viewport(1280, 420)
      await until(() => scrollRange(tmViewHost()) > 60, 'a TM view taller than its tile')
      await scrolled('tm-0', 60)
      expect(
        inSight(firstButton('tm-0').getBoundingClientRect(), 'tm-0'),
        'precondition: the TM view’s first control is out of sight at 60 px',
      ).toBe(false)
      ;(sourcePane().querySelector('button.view-close') as HTMLElement).focus()
      await userEvent.keyboard('{Enter}')
      expect(mounted()).toEqual(['tm-0'])
      const focused = await focusedOn('tm-0', 'after Enter on the source view’s ✕')
      expect(focused.matches(':focus-visible'), 'a key press drew no focus ring').toBe(true)
      expect(inSight(focused.getBoundingClientRect(), 'tm-0'), 'the focused control is out of sight').toBe(true)
      expect(tmViewHost().scrollTop, 'the TM view did not move up to its first control').toBeLessThan(10)
    })

    /** The key's half again, for a view key: `4` hides the TM view, which has the focus, and the source view takes it. */
    it('shows the focused control and keeps the editor when a view key hides the view that had the focus', async () => {
      await resetToFirstLoad()
      await userEvent.click(tmViewHost().querySelector('.state-table') as HTMLElement)
      expect(document.activeElement?.closest('[data-leaf]'), 'precondition: the focus is in the TM view').toBe(
        host('tm-0'),
      )
      await scrolled('source', 120)
      await viewKey('4')
      expect(mounted()).toEqual(['source'])
      const focused = await focusedOn('source', 'after the view key')
      expect(focused.matches(':focus-visible')).toBe(true)
      expect(inSight(focused.getBoundingClientRect(), 'source'), 'the focused control is out of sight').toBe(true)
      expect(sourceScroller().scrollTop, 'a focus that was in sight already moved the source editor').toBe(120)
    })

    /**
     * A TOGGLE KEEPS THE FOCUS IT IS PRESSED WITH, SO NEITHER HALF APPLIES: nothing in the views is given the focus,
     * and every view that stays is where it was.
     */
    it('is kept when a toggle is pressed with the pointer, which keeps the focus', async () => {
      await resetToFirstLoad()
      await scrolled('source', 120)
      await userEvent.click(toggle('tm'))
      expect(mounted()).toEqual(['source'])
      expect(document.activeElement, 'the toggle lost the focus when it hid the TM view').toBe(toggle('tm'))
      expect(sourceScroller().scrollTop, 'hiding the TM view reset the source view').toBe(120)
      await userEvent.click(toggle('tm'))
      expect(mounted()).toEqual(['source', 'tm-0'])
      expect(document.activeElement).toBe(toggle('tm'))
      expect(sourceScroller().scrollTop, 'showing the TM view reset the source view').toBe(120)
    })

    /**
     * **A VIEW KEY PRESSED FROM AN EDITOR GIVES THE FOCUS BACK TO IT, AND THE EDITOR STAYS WHERE IT WAS WHILE THE CARET
     * SHOWS.** It is asked for its caret and not for its box. While the source view's own box was what scrolled, the
     * editor was taller than its view: at 120 px a bare `focus()` put the view at 0, and at 0 `scrollIntoView` on
     * the editor's box put it at 59, the editor's top brought to the view's.
     */
    it('is kept when a view key is pressed from the source editor, at 120 px and at the top', async () => {
      await resetToFirstLoad()
      await scrolled('source', 120)
      await caretAt(300)
      expect(sourceScroller().scrollTop, 'precondition: the click in the editor left the view at 120').toBe(120)
      await viewKey('3')
      expect(mounted()).toEqual(['source', 'lambda-0', 'tm-0'])
      await frames()
      expect(view.hasFocus, 'the source editor lost the focus').toBe(true)
      expect(sourceScroller().scrollTop, 'a view key reset the editor it was pressed in').toBe(120)
      expect(inEditor(caret()), 'the caret is out of sight').toBe(true)

      await scrolled('source', 0)
      await caretAt(60)
      expect(sourceScroller().scrollTop, 'precondition: the click in the editor left the view at its top').toBe(0)
      await viewKey('3')
      expect(mounted()).toEqual(['source', 'tm-0'])
      await frames()
      expect(view.hasFocus).toBe(true)
      expect(sourceScroller().scrollTop, 'a view key moved a view at its top').toBe(0)
    })

    /**
     * *RESET PRESET* GIVES THE FOCUS TO THE TM VIEW, AND KEEPS THE ONE THAT SHOWS THE PROGRAM. In a window 420 px
     * tall the TM view is taller than its tile, so its own box scrolls: pressed with the pointer, the reset leaves it
     * where it was.
     */
    it('is kept by the TM view when reset preset is pressed with the pointer', async () => {
      await resetToFirstLoad()
      await page.viewport(1280, 420)
      await until(() => scrollRange(tmViewHost()) > 60, 'a TM view taller than its tile')
      await scrolled('tm-0', 60)
      await scrolled('source', 120)
      await userEvent.click(document.querySelector('#workspace') as HTMLElement)
      await userEvent.click(document.querySelector('#reset-preset') as HTMLElement)
      expect(notice(), 'precondition: the reset ran').toContain('reset — the default views are back')
      const focused = await focusedOn('tm-0', 'after reset preset')
      expect(focused.matches(':focus-visible')).toBe(false)
      expect(tmViewHost().scrollTop, 'reset preset reset the TM view it gave the focus to').toBe(60)
      expect(sourceScroller().scrollTop, 'reset preset reset the source view').toBe(120)
    })

    /**
     * **AN OPENED LINK'S *UNDO* BUILDS EVERY VIEW AGAIN, SO NEITHER HALF HAS ANYTHING TO KEEP**: the program it puts
     * back opens at its top, as the link's did (`scroll-kept.test.ts`), with the focus in the source editor, where the
     * undo itself sends it. Last here, since it replaces the program and puts it back.
     */
    it('is not kept by an opened link’s undo, which builds every view again', async () => {
      await resetToFirstLoad()
      location.hash = await encodeLink({
        program: LINKED,
        encoding: 'unary',
        workspace: serializeWorkspace(defaultWorkspace('wide')),
        positions: {},
      })
      await until(() => notice() === 'opened a shared link', 'the link to open')
      expect(view.state.doc.toString(), 'precondition: the link’s program is in the editor').toBe(LINKED)
      await scrolled('source', 120)
      await userEvent.click(document.querySelector('#notice button.notice-action') as HTMLElement)
      await until(() => notice() === 'put back the program and the workspace', 'the undo')
      expect(view.state.doc.toString()).toBe(PROGRAM)
      expect(
        scrollRange(sourceScroller()),
        'precondition: the program put back could be scrolled as far',
      ).toBeGreaterThan(120)
      expect(sourceScroller().scrollTop, 'the program put back opened where the link’s was scrolled to').toBe(0)
      await frames()
      expect(view.hasFocus, 'the undo did not leave the focus in the source editor').toBe(true)
      await until(stateIdle, 'the program put back to compile')
    })
  })

  describe('on all four views, in the wide default', () => {
    /** The source view is over the asm view, and is the neighbour its `✕` gives the focus to. */
    it('is kept by the source view when the asm view under it is closed with the pointer', async () => {
      await showWideDefault()
      await scrolled('source', 120)
      await userEvent.click((host('asm-0') as HTMLElement).querySelector('button.view-close') as HTMLElement)
      expect(drawn()).toBe('row[50](source column[50](lambda-0 tm-0))')
      const focused = await focusedOn('source', 'after the ✕')
      expect(focused.matches(':focus-visible')).toBe(false)
      expect(sourceScroller().scrollTop, 'the ✕ on the asm view reset the source view over it').toBe(120)
    })

    /**
     * **A VIEW KEY THAT MAKES THE EDITOR'S VIEW SHORTER BRINGS THE CARET BACK INTO SIGHT.** With three views the
     * source view is the window's height; `2` shows the asm view under it and halves it. The caret is put lower in
     * the view than the halved view is tall, so the view has to move for it to show.
     */
    it('follows the caret when a view key halves the view its editor is in', async () => {
      await showWideDefault()
      toggle('asm').click()
      await until(() => mounted().join() === 'source,lambda-0,tm-0', 'the asm view to be hidden')
      const tall = sourcePane().clientHeight
      await caretAt(tall - 80)
      const down = caret().top - sourcePane().getBoundingClientRect().top
      const before = sourceScroller().scrollTop
      await viewKey('2')
      expect(drawn()).toBe('row[50](column[50](source asm-0) column[50](lambda-0 tm-0))')
      await frames()
      expect(sourcePane().clientHeight, 'precondition: the source view was made shorter').toBeLessThan(tall - 100)
      expect(down, 'precondition: the caret was lower than the view is now tall').toBeGreaterThan(
        sourcePane().clientHeight,
      )
      expect(view.hasFocus, 'the source editor lost the focus').toBe(true)
      expect(inEditor(caret()), 'the caret is out of sight in the view the key made shorter').toBe(true)
      expect(sourceScroller().scrollTop, 'the view did not move').toBeGreaterThan(before)
    })
  })
})
