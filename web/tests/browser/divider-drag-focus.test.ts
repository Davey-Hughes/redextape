import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import {
  focusInPage,
  frames,
  holdsFocus,
  host,
  resetToFirstLoad,
  SHELL,
  showWideDefault,
  sourcePane,
  sourceScroller,
  stateIdle,
  until,
} from './harness'

/**
 * A DIVIDER'S GESTURE LEAVES THE KEYBOARD FOCUS WHERE IT WAS — `pane-host.ts`'s `resized`.
 *
 * A divider's press moves no focus (`layout-view.ts`'s `divider` prevents it, so a drag selects no text), so the caret
 * is still in its editor while the pointer drags. The drag's end is a rebuild, which detaches every view's host, and
 * the focus went to `<body>` with them: measured before `resized` (2026-10-12), with the caret in the source editor
 * and the divider beside it dragged 80 px, `document.activeElement` was `<body>` at once and two frames on, and a key
 * typed next went nowhere. `divider-drag.test.ts` makes its own pointer events and never reads the focus.
 *
 * **EVERY DRAG HERE IS THE DRIVER'S OWN**, a press on the divider and a release 80 px along it, and every key is a
 * real one. Where the focus starts is arranged, by a click of the driver's or by `focus()`.
 *
 * **A POINTER'S GESTURE SCROLLS NOTHING** (`pane-host.ts`'s `moveFocus`), and a drag is always a pointer's where it
 * has a focus to give back: the second case has the caret out of sight, where a give-back that brought it into
 * sight moved the view from 500 px to 80, while the source view's own box was what scrolled a long program.
 *
 * **A DIVIDER MOVED WITH ITS OWN KEYS HAS THE FOCUS ITSELF**, and is built again at the end of each press: the render
 * focuses the new one (`layout-view.ts`'s `renderLayout`), which is held here beside the rest.
 */

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.removeItem(LAYOUT_STORAGE_KEY)

/** 61 lines, so the source editor scrolls, and no line long enough to wrap when the view is made narrower. */
const PROGRAM = `let x = 40;${'\n'.repeat(60)}x + 2`

let view: EditorView

const dividerAt = (path: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#views .layout-divider[data-path="${path}"]`) as HTMLElement
const share = (path: string): number => Number(dividerAt(path).getAttribute('aria-valuenow'))

/** Press the divider at `path` with the pointer and let it go 80 px along its split. */
async function drag(path: string): Promise<void> {
  const divider = dividerAt(path)
  const views = document.querySelector('#views') as HTMLElement
  const [at, area] = [divider.getBoundingClientRect(), views.getBoundingClientRect()]
  const across = divider.getAttribute('aria-orientation') === 'vertical'
  const before = share(path)
  await userEvent.dragAndDrop(divider, views, {
    targetPosition: {
      x: at.left - area.left + (across ? 80 : at.width / 2),
      y: at.top - area.top + (across ? at.height / 2 : 80),
    },
  })
  expect(share(path), 'precondition: the drag moved its divider').toBeGreaterThan(before)
}

/** Put the caret at the start of line `line` of the source editor, with the focus in it. */
async function caretOn(line: number): Promise<number> {
  view.focus()
  view.dispatch({ selection: { anchor: view.state.doc.line(line).from } })
  await until(() => view.hasFocus, 'the source editor to take the focus')
  return view.state.selection.main.head
}

beforeAll(async () => {
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
})

// THE PROGRAM AS THIS FILE WROTE IT, WHATEVER A CASE TYPED, and each describe then arranges its views.
beforeEach(async () => {
  if (view.state.doc.toString() !== PROGRAM)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: PROGRAM } })
  await until(stateIdle, 'the compile')
})

describe('a divider dragged with the pointer, on the source beside the TM view', () => {
  beforeEach(async () => {
    await resetToFirstLoad()
    expect(
      sourceScroller().scrollHeight - sourceScroller().clientHeight,
      'precondition: the source editor scrolls',
    ).toBeGreaterThan(500)
  })

  it('leaves the caret in the editor it was in, and a key typed next lands at it', async () => {
    sourceScroller().scrollTop = 120
    // A CLICK OF THE DRIVER'S IN A LINE THAT IS IN SIGHT, which is how the caret comes to be mid-document.
    const line = [...sourcePane().querySelectorAll<HTMLElement>('.cm-line')].find(
      (l) => l.getBoundingClientRect().top > sourcePane().getBoundingClientRect().top + 200,
    )
    await userEvent.click(line as HTMLElement)
    const caret = view.state.selection.main.head
    expect(view.hasFocus, 'precondition: the click put the focus in the editor').toBe(true)
    expect(caret, 'precondition: the caret is past the first line').toBeGreaterThan(PROGRAM.indexOf('\n'))
    expect(caret, 'precondition: and short of the last').toBeLessThan(PROGRAM.lastIndexOf('\n'))
    const scrolled = sourceScroller().scrollTop
    expect(scrolled, 'precondition: the source view is scrolled').toBeGreaterThan(0)

    await drag('[]')
    await holdsFocus(view.contentDOM, 'the drag took the focus out of the editor')
    expect(view.hasFocus).toBe(true)
    expect(view.state.selection.main.head, 'the drag moved the caret').toBe(caret)
    expect(sourceScroller().scrollTop, 'the drag scrolled the view').toBe(scrolled)

    await userEvent.keyboard('Z')
    expect(view.state.doc.toString(), 'the key typed after the drag did not land at the caret').toBe(
      `${PROGRAM.slice(0, caret)}Z${PROGRAM.slice(caret)}`,
    )
  })

  /**
   * **THE CARET IS WRITTEN BACK AS THE EDITOR IS FOCUSED, WHATEVER THE FRAME THEN COSTS** (`pane-host.ts`'s
   * `moveFocus`). Focused by the DOM's `focus()`, the editor has the browser's selection, at the start of its text,
   * and CodeMirror puts its own back only where it hears of that within 200 ms of the focus. A listener that spends
   * 250 ms at the `focus` stands for a frame that takes that long, as a view's `focusin` can, which draws every view.
   */
  it('leaves the caret where it was when the focus is given back in a slow frame', async () => {
    const caret = await caretOn(3)
    const slow = (): void => {
      const end = performance.now() + 250
      while (performance.now() < end) {
        // A FRAME'S WORK, between the focus and the browser's word of the selection.
      }
    }
    view.contentDOM.addEventListener('focus', slow)
    try {
      await drag('[]')
    } finally {
      view.contentDOM.removeEventListener('focus', slow)
    }
    await holdsFocus(view.contentDOM, 'the drag took the focus out of the editor')
    // HELD WHETHER OR NOT THE CARET WAS, so a caret that moved is reported with where the key then went.
    expect.soft(view.state.selection.main.head, 'the drag moved the caret').toBe(caret)
    await userEvent.keyboard('Z')
    expect(view.state.doc.toString(), 'the key typed after the drag did not land at the caret').toBe(
      `${PROGRAM.slice(0, caret)}Z${PROGRAM.slice(caret)}`,
    )
  })

  it('does not scroll the view to a caret that is out of sight', async () => {
    await caretOn(2)
    sourceScroller().scrollTop = 500
    await frames()
    expect(sourceScroller().scrollTop, 'precondition: the view is scrolled past the caret').toBe(500)

    await drag('[]')
    await holdsFocus(view.contentDOM, 'the drag took the focus out of the editor')
    expect(sourceScroller().scrollTop, 'the focus given back after a pointer’s drag scrolled the view').toBe(500)
  })

  it('leaves the focus on what had it in the other view', async () => {
    const table = (host('tm-0') as HTMLElement).querySelector('.state-table') as HTMLElement
    await userEvent.click(table)
    const held = document.activeElement
    expect(host('tm-0')?.contains(held), 'precondition: the click put the focus in the TM view').toBe(true)

    await drag('[]')
    await holdsFocus(held as Element, 'the drag took the focus from the TM view')
  })

  it('leaves the focus on a divider dragged while it has it', async () => {
    dividerAt('[]').focus()
    await drag('[]')
    await holdsFocus(dividerAt('[]'), 'the drag took the focus from its divider')
  })
})

describe('a divider moved with its keys', () => {
  beforeEach(resetToFirstLoad)

  it('keeps the focus through each press, and the next press moves it again', async () => {
    dividerAt('[]').focus()
    expect(share('[]'), 'precondition: the divider is at a half').toBe(50)
    await userEvent.keyboard('{ArrowRight}')
    expect(share('[]'), 'the first key did not move the divider').toBe(52)
    await holdsFocus(dividerAt('[]'), 'the first key cost the divider the focus')
    await userEvent.keyboard('{ArrowRight}')
    expect(share('[]'), 'the second key did not move the divider').toBe(54)
    await holdsFocus(dividerAt('[]'), 'the second key cost the divider the focus')
  })
})

describe('a divider dragged with the pointer, on all four views in two columns', () => {
  beforeEach(showWideDefault)

  /** The divider between the columns, and the one inside each: the source view's box changes for two of the three. */
  it.each(['[]', '[0]', '[1]'])('leaves the caret in the source editor: the divider at %s', async (path) => {
    const caret = await caretOn(3)
    await drag(path)
    await holdsFocus(view.contentDOM, 'the drag took the focus out of the editor')
    await focusInPage(`a drag of the divider at ${path}`)
    expect(view.state.selection.main.head, 'the drag moved the caret').toBe(caret)
    await userEvent.keyboard('Z')
    expect(view.state.doc.toString(), 'the key typed after the drag did not land at the caret').toBe(
      `${PROGRAM.slice(0, caret)}Z${PROGRAM.slice(caret)}`,
    )
  })
})
