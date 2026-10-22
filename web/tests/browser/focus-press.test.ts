import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { cdp, page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import {
  clickWorkspaceItem,
  compile,
  frame,
  host,
  inspector,
  pageCentreOf,
  rect,
  results,
  SHELL,
  tick,
  until,
  views,
} from './harness'

/**
 * **A FIRST PRESS THAT MOVES THE FOCUS INTO ANOTHER VIEW LANDS ON THE CONTROL IT WAS MADE ON** — `focus-draw.ts`.
 *
 * At a phone's width the frame a focus move draws changes the page's layout: in Explorer at 390×844 the strip's readout
 * takes three lines for the program and two for a TM copy, and in Debugger the inspector stacked under the views is
 * taller for the program's rows than for the copy's. A control low in a view moves with them, and drawn at the press's
 * own focus move it would move between the press and the release: the release would not be on it, and the browser
 * would send the click to an element holding both. So the draw a focus move owes waits for the press to end.
 *
 * **EVERY CASE THAT PRESSES A CONTROL IN A VIEW MEASURES ITS PREMISE AND ASSERTS ITS PRECONDITION BEFORE IT
 * PRESSES.** The premise: a focus move into the control's view with no press, made with `focus()` on the control
 * itself, draws it more than half its height away, so a case cannot pass because nothing moved. The precondition, once
 * the focus is back where the press leaves from: the focus there, the control in the viewport and the element at its
 * centre. The `<select>` case, whose press is on the step bar, outside every view, asserts its own precondition, no
 * press held when it begins among it. Every press is real input: `userEvent`
 * for the mouse, CDP's `Input.dispatchTouchEvent` for a finger, and CDP's `Input.dispatchMouseEvent` for a press held
 * with no release: while the top-level page takes the window's focus, at a right press's `contextmenu`, and on a
 * `<select>`.
 *
 * **THE SOURCE VIEW AND THE TM VIEW SHARE THE BOTTOM ROW**, stored before the mount: a press into the source view moves
 * its controls only where its row's top moves, and the top row's does not. **SIXTY FUNCTIONS**, the program whose
 * readout takes three lines of the strip at 390 px. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

const MANY = `${Array.from({ length: 60 }, (_, i) => `fn f${i}(n) { n }`).join('\n')}\nf0(1)\n`

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.setItem(
  LAYOUT_STORAGE_KEY,
  serializeWorkspace({
    ...defaultWorkspace('wide'),
    tree: {
      kind: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [
        {
          kind: 'split',
          dir: 'row',
          sizes: [0.5, 0.5],
          children: [
            { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
            { kind: 'leaf', id: 'asm-0', pane: 'asm' },
          ],
        },
        {
          kind: 'split',
          dir: 'row',
          sizes: [0.5, 0.5],
          children: [
            { kind: 'leaf', id: 'source', pane: 'source' },
            { kind: 'leaf', id: 'tm-0', pane: 'tm' },
          ],
        },
      ],
    },
    focused: 'source',
  }),
)

let view: EditorView
const copy = () => host('tm-0') as HTMLElement
const source = () => host('source') as HTMLElement
const outline = (pane: HTMLElement) => pane.querySelector<HTMLElement>('.panel[data-panel="outline"]') as HTMLElement
const disclosure = (pane: HTMLElement) => outline(pane).querySelector<HTMLElement>('.panel-toggle') as HTMLElement
const maximise = (pane: HTMLElement) => outline(pane).querySelector<HTMLElement>('.panel-maximise') as HTMLElement
const open = (pane: HTMLElement) => outline(pane).dataset.open === 'true'
const maximised = (pane: HTMLElement) => maximise(pane).getAttribute('aria-pressed') === 'true'
/** Whether the readout, in the strip or the inspector, describes the program, which the source view's focus draws. */
const programReadout = () => results().dataset.describes === 'program'
/** Whether it describes a copy, which the TM copy's focus draws. */
const copyReadout = () => results().dataset.describes === 'copy'
const settle = async () => {
  for (let i = 0; i < 4; i++) await frame()
}

/** The focus into the source editor, and the program's readout, which that focus draws with no press in progress. */
async function focusSource(): Promise<void> {
  view.focus()
  await until(() => view.hasFocus && programReadout(), 'the source view’s focus and the program’s readout')
  await settle()
}

/** The focus onto the TM copy's `⋯`, and the copy's readout, which that focus draws with no press in progress. */
async function focusCopy(): Promise<void> {
  ;(copy().querySelector('button.view-more') as HTMLElement).focus()
  await until(copyReadout, 'the copy’s focus and its readout')
  await settle()
}

/**
 * Scroll `el` to its view's middle, **MEASURE THE CASE'S PREMISE** — `focus()` on `el`, with no press, draws it more
 * than half its height away — and put the focus back with `back`. Then scroll it to the middle again, and **ASSERT THE
 * PRESS'S PRECONDITION**: the focus in `from`, the control where it was before the premise, in the viewport, and the
 * element at its centre.
 *
 * **SCROLLED AGAIN, BECAUSE THE PREMISE'S ROUND TRIP DOES NOT PUT THE VIEW'S SCROLL BACK**: the view is taller while
 * the other readout is drawn, its scroll is clamped to the shorter range, and it stays there when the view shrinks
 * again.
 */
async function aim(el: () => HTMLElement, from: HTMLElement, back: () => Promise<void>): Promise<void> {
  el().scrollIntoView({ block: 'center' })
  await settle()
  const before = rect(el())
  el().focus({ preventScroll: true })
  await settle()
  const by = Math.abs(rect(el()).top - before.top)
  expect(by, `premise: a focus move into its view draws the control elsewhere, by ${by} px`).toBeGreaterThan(
    before.height / 2,
  )
  await back()
  el().scrollIntoView({ block: 'center' })
  await settle()
  const box = rect(el())
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  expect(from.contains(document.activeElement), 'precondition: the focus in the view the press leaves').toBe(true)
  expect(box.top, 'precondition: the control drawn where it was before the premise').toBeCloseTo(before.top, 0)
  expect(box.top >= 0 && box.bottom <= innerHeight, `precondition: the control in the viewport, ${box.top}`).toBe(true)
  expect(hit !== null && el().contains(hit), 'precondition: the control is what its centre hits').toBe(true)
}

/** A finger's tap at `el`'s centre, as CDP sends one: its touch, then its release. */
async function tap(el: HTMLElement): Promise<void> {
  const at = pageCentreOf(el)
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] })
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

beforeAll(async () => {
  await page.viewport(390, 844)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await compile(view, MANY)
  await until(() => copy().querySelector('button.detach') !== null, 'the TM view')
  ;(copy().querySelector('button.detach') as HTMLButtonElement).click()
  await until(() => copy().querySelector('.term-editor') !== null, 'the TM copy’s editor')
})

describe('a first press into the TM copy at 390×844, the focus in the source view', () => {
  it('opens the copy’s outline from its disclosure, in Explorer', async () => {
    expect(document.querySelector('#workspace')?.textContent, 'precondition: the preset').toMatch(/^explorer/i)
    await focusSource()
    expect(open(copy()), 'precondition: the outline is closed').toBe(false)
    await aim(() => disclosure(copy()), source(), focusSource)
    await userEvent.click(disclosure(copy()))
    await until(copyReadout, 'the copy’s readout')
    expect(open(copy()), 'the press opened the outline').toBe(true)
  })

  it('maximises the copy’s outline, in Explorer', async () => {
    await focusSource()
    expect(maximised(copy()), 'precondition: the outline is not maximised').toBe(false)
    await aim(() => maximise(copy()), source(), focusSource)
    await userEvent.click(maximise(copy()))
    await until(copyReadout, 'the copy’s readout')
    expect(maximised(copy()), 'the press maximised the outline').toBe(true)
    await userEvent.click(maximise(copy()))
    await until(() => !maximised(copy()), 'the second press to end the maximise')
  })

  /**
   * **A TAP MOVES THE FOCUS AFTER THE FINGER IS LIFTED**: the browser fires the touch's `pointerup` first, and then the
   * `mousedown` whose default moves the focus, and the `mouseup` and `click` after it. So the press a tap's focus move
   * is made in is that `mousedown`'s.
   */
  it('maximises the copy’s outline from a tap, in Explorer', async () => {
    await focusSource()
    expect(maximised(copy()), 'precondition: the outline is not maximised').toBe(false)
    await aim(() => maximise(copy()), source(), focusSource)
    await tap(maximise(copy()))
    await until(copyReadout, 'the copy’s readout')
    expect(maximised(copy()), 'the tap maximised the outline').toBe(true)
    await userEvent.click(maximise(copy()))
    await until(() => !maximised(copy()), 'the second press to end the maximise')
  })

  it('maximises the copy’s outline, in Debugger with the inspector stacked under the views', async () => {
    clickWorkspaceItem('[data-preset="debugger"]')
    await until(() => !inspector().hidden, 'the inspector')
    await focusSource()
    expect(rect(inspector()).top, 'precondition: the inspector under the views').toBeGreaterThanOrEqual(
      rect(views()).bottom - 0.5,
    )
    expect(maximised(copy()), 'precondition: the outline is not maximised').toBe(false)
    await aim(() => maximise(copy()), source(), focusSource)
    await userEvent.click(maximise(copy()))
    await until(copyReadout, 'the copy’s readout')
    expect(maximised(copy()), 'the press maximised the outline').toBe(true)
    await userEvent.click(maximise(copy()))
    await until(() => !maximised(copy()), 'the second press to end the maximise')
  })
})

describe('a first press into the source view at 390×844, the focus in the TM copy', () => {
  it('opens the source view’s outline from its disclosure, in Debugger with the inspector stacked', async () => {
    expect(document.querySelector('#workspace')?.textContent, 'precondition: the preset').toMatch(/^debugger/i)
    await focusCopy()
    expect(rect(inspector()).top, 'precondition: the inspector under the views').toBeGreaterThanOrEqual(
      rect(views()).bottom - 0.5,
    )
    expect(open(source()), 'precondition: the source view’s outline is closed').toBe(false)
    await aim(() => disclosure(source()), copy(), focusCopy)
    await userEvent.click(disclosure(source()))
    await until(programReadout, 'the program’s readout')
    expect(open(source()), 'the press opened the source view’s outline').toBe(true)
  })
})

describe('a press whose release never comes', () => {
  /**
   * **A TOUCH THE BROWSER CANCELS ENDS IN `pointercancel`**, with no `pointerup` after it. Left pressed, the page would
   * hold every later focus move's draw until some other press ended, and a keyboard's focus move would draw nothing.
   */
  it('leaves a keyboard’s focus move after a cancelled touch drawn at once', async () => {
    await focusSource()
    await aim(() => maximise(copy()), source(), focusSource)
    const heard: string[] = []
    const hear = (e: Event): void => {
      heard.push(e.type)
    }
    for (const type of ['pointerdown', 'pointerup', 'pointercancel']) window.addEventListener(type, hear)
    const at = pageCentreOf(maximise(copy()))
    await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] })
    await cdp().send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await settle()
    for (const type of ['pointerdown', 'pointerup', 'pointercancel']) window.removeEventListener(type, hear)
    expect(heard, 'precondition: the touch began a press and the browser cancelled it').toEqual([
      'pointerdown',
      'pointercancel',
    ])
    expect(source().contains(document.activeElement), 'precondition: the cancelled touch moved no focus').toBe(true)
    // TWO TABS: the first is the divider between the source view and the copy, which is in no view.
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement?.closest('[data-leaf]'), 'precondition: the first Tab leaves every view').toBeNull()
    expect(programReadout(), 'precondition: the program’s readout').toBe(true)
    await userEvent.keyboard('{Tab}')
    expect(copy().contains(document.activeElement), 'precondition: the second Tab is in the copy').toBe(true)
    expect(results().dataset.describes, 'the copy’s readout, drawn at the focus move').toBe('copy')
  })

  /**
   * **THE WINDOW'S LOSS OF THE FOCUS ENDS A PRESS**: its release may go to another window, and this page would hear
   * none. The press is held here, the focus moved by it; the top-level page takes the focus, and the owed draw is made
   * before the release is sent at all.
   */
  it('draws a press’s focus move when the window loses the focus before the release', async () => {
    await focusSource()
    await aim(() => maximise(copy()), source(), focusSource)
    const at = pageCentreOf(maximise(copy()))
    await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y })
    await cdp().send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: at.x,
      y: at.y,
      button: 'left',
      clickCount: 1,
    })
    expect(copy().contains(document.activeElement), 'precondition: the press moved the focus into the copy').toBe(true)
    expect(programReadout(), 'precondition: the press has not drawn its focus move').toBe(true)
    await cdp().send('Runtime.evaluate', {
      expression: `(() => { const b = document.createElement('button'); document.body.append(b); b.focus(); b.remove() })()`,
    })
    expect(document.hasFocus(), 'precondition: the window lost the focus').toBe(false)
    await tick()
    await until(copyReadout, 'the copy’s readout, before any release')
    window.focus()
    await cdp().send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: at.x,
      y: at.y,
      button: 'left',
      clickCount: 1,
    })
  })

  /**
   * **A `contextmenu` ENDS A PRESS**: the menu it opens may take the release. On Linux, where this runs, and on macOS,
   * the browser fires it at a right press itself, before any release, and the owed draw is made then; on Windows it
   * follows the `mouseup`, which has ended the press already.
   */
  it('draws a right press’s focus move at its contextmenu, before the release', async () => {
    await focusSource()
    await aim(() => maximise(copy()), source(), focusSource)
    let menus = 0
    const count = (): void => {
      menus++
    }
    window.addEventListener('contextmenu', count)
    const at = pageCentreOf(maximise(copy()))
    await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y })
    await cdp().send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: at.x,
      y: at.y,
      button: 'right',
      clickCount: 1,
    })
    window.removeEventListener('contextmenu', count)
    expect(menus, 'precondition: the press fired its contextmenu').toBe(1)
    expect(copy().contains(document.activeElement), 'precondition: the press moved the focus into the copy').toBe(true)
    await until(copyReadout, 'the copy’s readout, before any release')
    await cdp().send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: at.x,
      y: at.y,
      button: 'right',
      clickCount: 1,
    })
  })

  /**
   * **A PRESS ON A `<select>` BEGINS NONE**: its popup can take the release, and this page would hear none. The press
   * is held here with no release, as such a popup would hold it, and a focus move made during it draws at once.
   *
   * **NO PRESS IS HELD WHEN IT BEGINS**: a press an earlier case left open would fail this one where a missing guard
   * fails it, so a focus move made before the `<select>`'s press must draw at once.
   *
   * **WHAT THIS REACHES**: the press's `pointerdown` and `mousedown` on the step bar's `<select>`, heard by the page
   * with the window keeping the focus and nothing else ending the press. **WHAT IT DOES NOT**: whether a desktop's
   * popup sends the release anywhere, which headless Chrome's popup does not show.
   */
  it('draws a focus move made while a press on a `<select>` is held, at once', async () => {
    await focusSource()
    ;(copy().querySelector('button.view-more') as HTMLElement).focus()
    expect(results().dataset.describes, 'precondition: no press held, so a focus move draws at once').toBe('copy')
    await focusSource()
    const speed = document.querySelector<HTMLSelectElement>('#step-bar select.speed') as HTMLSelectElement
    const box = rect(speed)
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    expect(box.top >= 0 && box.bottom <= innerHeight, `precondition: the select in the viewport, ${box.top}`).toBe(true)
    expect(hit, 'precondition: the select is what its centre hits').toBe(speed)
    const heard: string[] = []
    // EVERY END A PRESS HAS, AND THE WINDOW'S OWN `blur` ONLY: the select's press blurs the element it leaves.
    const hear = (e: Event): void => {
      const on = e.target instanceof Element ? e.target.localName : e.target === window ? 'window' : null
      if (on !== null && (e.type !== 'blur' || on === 'window')) heard.push(`${e.type} ${on}`)
    }
    const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'pointercancel', 'contextmenu', 'blur']
    for (const type of types) window.addEventListener(type, hear, { capture: true })
    const at = pageCentreOf(speed)
    try {
      await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y })
      await cdp().send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: at.x,
        y: at.y,
        button: 'left',
        clickCount: 1,
      })
      await settle()
      expect(heard, 'precondition: the press reached the select, and nothing ended it').toEqual([
        'pointerdown select',
        'mousedown select',
      ])
      expect(document.hasFocus(), 'precondition: the window kept the focus').toBe(true)
      expect(programReadout(), 'precondition: the program’s readout').toBe(true)
      ;(copy().querySelector('button.view-more') as HTMLElement).focus()
      expect(copy().contains(document.activeElement), 'precondition: the focus in the copy').toBe(true)
      expect(results().dataset.describes, 'the copy’s readout, drawn at the focus move').toBe('copy')
    } finally {
      // RELEASED IN A `finally`, so a failure here leaves no button held for the files after this one.
      await cdp().send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: at.x,
        y: at.y,
        button: 'left',
        clickCount: 1,
      })
      for (const type of types) window.removeEventListener(type, hear, { capture: true })
    }
  })
})
