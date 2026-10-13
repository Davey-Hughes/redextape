import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { encodeLink } from '../../src/share-link'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { drawn, resetToFirstLoad, SHELL, showWideDefault, until } from './harness'

/**
 * WHERE A VIEW IS SCROLLED TO ONCE A GESTURE HAS GIVEN IT THE FOCUS — the view layouts spec §4.5 and §5.2, and
 * `pane-host.ts`'s `moveFocus`: a focus the app moves as the consequence of a gesture scrolls nothing where the
 * gesture was a pointer's, and brings what it focused into sight where it was a key's.
 *
 * **A VIEW'S FIRST CONTROL IS IN ITS HEADER, WHICH SCROLLS WITH THE VIEW.** So the two halves cannot both keep a
 * scrolled view where it was: a pointer press leaves it there with its first control out of sight and no ring drawn
 * on it, and a key press brings the control into sight, which for a control in the header is the view at its top.
 * Each case says which half it is.
 *
 * **ON THE VIEWS A VISITOR GETS, NOT THE FOUR `setup.ts` STORES**: the source beside the TM view, and all four as two
 * columns. In both the source view is the neighbour a `✕` gives the focus to, and it is the one view whose own box is
 * what scrolls a long program. On the stored four, in two rows, the view `scroll-kept.test.ts` closes has the λ view
 * for its neighbour, and that file passed while a `✕` beside the source view put the source view at 0.
 *
 * `scroll-kept.test.ts` holds a scroll position across a rebuild made from ANOTHER view; this file holds it for the
 * view the rebuild's focus lands in.
 */

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.removeItem(LAYOUT_STORAGE_KEY)

const PROGRAM = `let x = 40;${'\n'.repeat(60)}x + 2`
/** A program a link carries, as long as `PROGRAM`. */
const LINKED = `let y = 10;${'\n'.repeat(60)}y + 5`
const PREFIX = '{Control>}.{/Control}'

let view: EditorView

const host = (leaf: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${leaf}"]:not([role="tab"])`) as HTMLElement
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const toggle = (kind: string): HTMLButtonElement =>
  document.querySelector(`#views-shown button[data-shows="${kind}"]`) as HTMLButtonElement
const source = (): HTMLElement => host('source')
const notice = (): string => (document.querySelector('#notice .notice-text')?.textContent ?? '').trim()
const idle = (): boolean => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
/** How far `el` can scroll down: a box that cannot is at 0 whatever it was given. */
const range = (el: HTMLElement): number => el.scrollHeight - el.clientHeight
/** The first control of a view, which is where a gesture that gives the view the focus puts it. */
const first = (leaf: string): HTMLElement => host(leaf).querySelector('button') as HTMLElement
/** Two frames: the one the page draws next, and one more. */
const frames = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

/** Whether all of `inner` shows in the box `leaf`'s view draws in: between its top and the bottom of what it shows. */
const inSight = (inner: { top: number; bottom: number }, leaf: string): boolean => {
  const box = host(leaf).getBoundingClientRect()
  return inner.top >= box.top - 0.5 && inner.bottom <= box.top + host(leaf).clientHeight + 0.5
}
/** Where the source editor's caret is drawn. */
const caret = (): { top: number; bottom: number } => {
  const at = view.coordsAtPos(view.state.selection.main.head)
  if (at === null) throw new Error('the caret has no place on the page')
  return at
}

/** The focus is on `leaf`'s first control, a frame on as well as now, and not on `<body>`. */
async function focusedOn(leaf: string, what: string): Promise<HTMLElement> {
  expect(document.activeElement, `${what}: the focus is not on the ${leaf} view’s first control`).toBe(first(leaf))
  await frames()
  expect(document.activeElement, `${what}: two frames on`).toBe(first(leaf))
  return first(leaf)
}

/** Scroll `leaf`'s own box to `top`, and assert it is there. */
async function scrolled(leaf: string, top: number): Promise<void> {
  expect(range(host(leaf)), `precondition: the ${leaf} view’s own box scrolls past ${top}`).toBeGreaterThan(top)
  host(leaf).scrollTop = top
  await until(() => host(leaf).scrollTop === top, `the ${leaf} view to hold its scroll`)
}

/** The prefix, then `key`. */
async function viewKey(key: string): Promise<void> {
  await userEvent.keyboard(PREFIX)
  expect((document.querySelector('#view-keys') as HTMLElement).hidden, 'the prefix did not arm the mode').toBe(false)
  await userEvent.keyboard(key)
}

/** Put the caret on a line of the source editor drawn `down` px or more below its view's top, with a real click. */
async function caretAt(down: number): Promise<void> {
  const top = source().getBoundingClientRect().top
  const line = [...source().querySelectorAll<HTMLElement>('.cm-line')].find(
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
    await until(idle, 'the first compile')
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
      await userEvent.click(host('tm-0').querySelector('button.view-close') as HTMLElement)
      expect(mounted()).toEqual(['source'])
      const focused = await focusedOn('source', 'after the ✕')
      expect(focused.matches(':focus-visible'), 'a pointer press drew a focus ring').toBe(false)
      expect(source().scrollTop, 'the ✕ on the TM view reset the source view’s own scroll box').toBe(120)
    })

    /** The same, with the view's `⋯` menu open when the `✕` is pressed: the press closes the menu and lands. */
    it('is kept when the ✕ is pressed with the view’s ⋯ menu open', async () => {
      await resetToFirstLoad()
      await scrolled('source', 120)
      const more = host('tm-0').querySelector('button.view-more') as HTMLElement
      await userEvent.click(more)
      expect(more.getAttribute('aria-expanded'), 'precondition: the ⋯ menu is open').toBe('true')
      await userEvent.click(host('tm-0').querySelector('button.view-close') as HTMLElement)
      expect(mounted()).toEqual(['source'])
      const focused = await focusedOn('source', 'after the ✕')
      expect(focused.matches(':focus-visible')).toBe(false)
      expect(source().scrollTop).toBe(120)
    })

    /**
     * THE KEY'S HALF, BY THE ROAD A KEYBOARD USER TAKES TO A `✕`: `Tab` from the view's `⋯`, then `Enter`. The focus
     * is on the source view's `⋯` with its ring drawn, and it has to be in sight.
     *
     * **THE SOURCE VIEW IS AT ITS TOP AFTERWARDS, AND THAT IS THE RULE, NOT A LOSS IT MISSED**: its `⋯` is the first
     * thing in its header, flush with the view's top, so there is one scroll position that shows it.
     */
    it('gives way to the focused control when the ✕ is pressed with Enter', async () => {
      await resetToFirstLoad()
      await scrolled('source', 120)
      ;(host('tm-0').querySelector('button.view-more') as HTMLElement).focus()
      await userEvent.keyboard('{Tab}')
      expect(document.activeElement, 'precondition: Tab from ⋯ reaches the ✕').toBe(
        host('tm-0').querySelector('button.view-close'),
      )
      await userEvent.keyboard('{Enter}')
      expect(mounted()).toEqual(['source'])
      const focused = await focusedOn('source', 'after Enter on the ✕')
      expect(focused.matches(':focus-visible'), 'a key press drew no focus ring').toBe(true)
      expect(inSight(focused.getBoundingClientRect(), 'source'), 'the focused control is out of sight').toBe(true)
      expect(source().scrollTop, 'the source view is not at its top, where its first control is').toBe(0)
    })

    /** The key's half again, for a view key: `4` hides the TM view, which has the focus, and the source view takes it. */
    it('gives way to the focused control when a view key hides the view that had the focus', async () => {
      await resetToFirstLoad()
      await userEvent.click(host('tm-0').querySelector('.state-table') as HTMLElement)
      expect(document.activeElement?.closest('[data-leaf]'), 'precondition: the focus is in the TM view').toBe(
        host('tm-0'),
      )
      await scrolled('source', 120)
      await viewKey('4')
      expect(mounted()).toEqual(['source'])
      const focused = await focusedOn('source', 'after the view key')
      expect(focused.matches(':focus-visible')).toBe(true)
      expect(inSight(focused.getBoundingClientRect(), 'source'), 'the focused control is out of sight').toBe(true)
      expect(source().scrollTop).toBe(0)
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
      expect(source().scrollTop, 'hiding the TM view reset the source view').toBe(120)
      await userEvent.click(toggle('tm'))
      expect(mounted()).toEqual(['source', 'tm-0'])
      expect(document.activeElement).toBe(toggle('tm'))
      expect(source().scrollTop, 'showing the TM view reset the source view').toBe(120)
    })

    /**
     * **A VIEW KEY PRESSED FROM AN EDITOR GIVES THE FOCUS BACK TO IT, AND THE VIEW STAYS WHERE IT WAS WHILE THE CARET
     * SHOWS.** The editor is taller than its view, so it is asked for its caret and not for its box: at 120 px a bare
     * `focus()` put the view at 0, and at 0 `scrollIntoView` on the editor's box put it at 59, the editor's top
     * brought to the view's.
     */
    it('is kept when a view key is pressed from the source editor, at 120 px and at the top', async () => {
      await resetToFirstLoad()
      await scrolled('source', 120)
      await caretAt(300)
      expect(source().scrollTop, 'precondition: the click in the editor left the view at 120').toBe(120)
      await viewKey('3')
      expect(mounted()).toEqual(['source', 'lambda-0', 'tm-0'])
      await frames()
      expect(view.hasFocus, 'the source editor lost the focus').toBe(true)
      expect(source().scrollTop, 'a view key reset the view its editor was pressed in').toBe(120)
      expect(inSight(caret(), 'source'), 'the caret is out of sight').toBe(true)

      await scrolled('source', 0)
      await caretAt(60)
      expect(source().scrollTop, 'precondition: the click in the editor left the view at its top').toBe(0)
      await viewKey('3')
      expect(mounted()).toEqual(['source', 'tm-0'])
      await frames()
      expect(view.hasFocus).toBe(true)
      expect(source().scrollTop, 'a view key moved a view at its top').toBe(0)
    })

    /**
     * *RESET PRESET* GIVES THE FOCUS TO THE TM VIEW, AND KEEPS THE ONE THAT SHOWS THE PROGRAM. In a window 420 px
     * tall the TM view is taller than its tile, so its own box scrolls: pressed with the pointer, the reset leaves it
     * where it was.
     */
    it('is kept by the TM view when reset preset is pressed with the pointer', async () => {
      await resetToFirstLoad()
      await page.viewport(1280, 420)
      await until(() => range(host('tm-0')) > 60, 'a TM view taller than its tile')
      await scrolled('tm-0', 60)
      await scrolled('source', 120)
      await userEvent.click(document.querySelector('#workspace') as HTMLElement)
      await userEvent.click(document.querySelector('#reset-preset') as HTMLElement)
      expect(notice(), 'precondition: the reset ran').toContain('reset — the default views are back')
      const focused = await focusedOn('tm-0', 'after reset preset')
      expect(focused.matches(':focus-visible')).toBe(false)
      expect(host('tm-0').scrollTop, 'reset preset reset the TM view it gave the focus to').toBe(60)
      expect(source().scrollTop, 'reset preset reset the source view').toBe(120)
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
      expect(range(source()), 'precondition: the program put back could be scrolled as far').toBeGreaterThan(120)
      expect(source().scrollTop, 'the program put back opened where the link’s was scrolled to').toBe(0)
      await frames()
      expect(view.hasFocus, 'the undo did not leave the focus in the source editor').toBe(true)
      await until(idle, 'the program put back to compile')
    })
  })

  describe('on all four views, in the wide default', () => {
    /** The source view is over the asm view, and is the neighbour its `✕` gives the focus to. */
    it('is kept by the source view when the asm view under it is closed with the pointer', async () => {
      await showWideDefault()
      await scrolled('source', 120)
      await userEvent.click(host('asm-0').querySelector('button.view-close') as HTMLElement)
      expect(drawn()).toBe('row[50](source column[50](lambda-0 tm-0))')
      const focused = await focusedOn('source', 'after the ✕')
      expect(focused.matches(':focus-visible')).toBe(false)
      expect(source().scrollTop, 'the ✕ on the asm view reset the source view over it').toBe(120)
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
      const tall = source().clientHeight
      await caretAt(tall - 80)
      const down = caret().top - source().getBoundingClientRect().top
      const before = source().scrollTop
      await viewKey('2')
      expect(drawn()).toBe('row[50](column[50](source asm-0) column[50](lambda-0 tm-0))')
      await frames()
      expect(source().clientHeight, 'precondition: the source view was made shorter').toBeLessThan(tall - 100)
      expect(down, 'precondition: the caret was lower than the view is now tall').toBeGreaterThan(source().clientHeight)
      expect(view.hasFocus, 'the source editor lost the focus').toBe(true)
      expect(inSight(caret(), 'source'), 'the caret is out of sight in the view the key made shorter').toBe(true)
      expect(source().scrollTop, 'the view did not move').toBeGreaterThan(before)
    })
  })
})
