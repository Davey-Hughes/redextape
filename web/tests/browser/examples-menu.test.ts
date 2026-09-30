import type { EditorView } from '@codemirror/view'
import { computeAccessibleName } from 'dom-accessibility-api'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES, type Example } from '../../src/examples'
import { SHELL, until } from './harness'

/**
 * **`examples ▾`: THE MENU, A PICK AND ITS UNDO** — Plan 7 part 6a spec §4.2, §4.5 and §6. Driven by real pointer
 * clicks and by keys, because a synthetic `.click()` is not the gesture. The page opens on the program `setup.ts`
 * stores, `let x = 40; x + 2`. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

const example = (id: string): Example => EXAMPLES.find((e) => e.id === id) as Example
const button = () => document.querySelector<HTMLButtonElement>('#examples') as HTMLButtonElement
const menu = () => document.querySelector<HTMLElement>('#examples-menu') as HTMLElement
const open = () => menu().matches(':popover-open')
const items = () => [...menu().querySelectorAll<HTMLButtonElement>('button.example')]
const item = (id: string) =>
  menu().querySelector<HTMLButtonElement>(`button[data-example="${id}"]`) as HTMLButtonElement
const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

let view: EditorView

beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && segments().length > 0, 'the first compile')
})

describe('examples ▾', () => {
  it('sits after copies ▾, in the chrome of the header’s other buttons', () => {
    const buffers = document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement
    expect(buffers.compareDocumentPosition(button()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const [a, b] = [buffers, button()].map((el) => el.getBoundingClientRect())
    expect(b?.left).toBeGreaterThan(a?.right ?? Number.POSITIVE_INFINITY)
    expect(b?.height).toBe(a?.height)
    const [x, y] = [buffers, button()].map((el) => getComputedStyle(el))
    for (const property of [
      'borderTopStyle',
      'borderTopWidth',
      'paddingLeft',
      'backgroundColor',
      'fontFamily',
    ] as const)
      expect(y?.[property], property).toBe(x?.[property])
  })

  it('opens on a click, with every example in the manifest’s order and the focus on the first', async () => {
    expect(computeAccessibleName(button())).toBe('examples')
    expect(button().getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(button())
    expect(open()).toBe(true)
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(items().map((b) => b.dataset.example)).toEqual(EXAMPLES.map((e) => e.id))
    // NAMED BY `aria-label`, SO THE NAME DOES NOT HANG ON THE TWO SPANS' `display` (spec §4.2).
    const names = EXAMPLES.map((e) => `${e.title} ${e.description}`)
    expect(items().map((b) => b.getAttribute('aria-label'))).toEqual(names)
    expect(items().map((b) => computeAccessibleName(b))).toEqual(names)
    expect(document.activeElement).toBe(items()[0])
  })

  it('draws each example as its title over a smaller, dimmer description', () => {
    const b = item('sum-to')
    const title = b.querySelector<HTMLElement>('.example-title') as HTMLElement
    const description = b.querySelector<HTMLElement>('.example-description') as HTMLElement
    expect(title.textContent).toBe('sum_to(5)')
    expect(description.getBoundingClientRect().top).toBeGreaterThanOrEqual(title.getBoundingClientRect().bottom - 0.5)
    expect(Number.parseFloat(getComputedStyle(description).fontSize)).toBeLessThan(
      Number.parseFloat(getComputedStyle(title).fontSize),
    )
    expect(getComputedStyle(description).color).not.toBe(getComputedStyle(title).color)
  })

  it('opens a picked example under unary, and says so with an undo', async () => {
    if (open()) menu().hidePopover()
    // ANOTHER ENCODING FIRST, so the pick has one to replace and the undo one to put back.
    await userEvent.selectOptions(picker(), 'binary')
    await until(() => idle() && segments().length > 0, 'the compile under binary')
    expect(picker().value).toBe('binary')

    await userEvent.click(button())
    await userEvent.click(item('fact'))
    expect(open()).toBe(false)
    expect(view.state.doc.toString()).toBe(example('fact').text)
    expect(picker().value).toBe('unary')
    expect(noticeText()).toBe('opened the example fact(4)')
    expect(undoButton()?.textContent).toBe('undo')
    await until(() => idle() && (segments()[1] ?? '').startsWith('asm 24'), 'the example’s compile')
  })

  it('puts back the text and the encoding it replaced on undo, with the focus in the editor, and says so', async () => {
    // EVERY SENTENCE THE LIVE REGION CARRIES DURING THE UNDO, AND WHERE THE FOCUS WAS AS IT WAS WRITTEN. A mutation
    // observer runs after the whole undo, focus and all, so it cannot tell a sentence said before the focus moved
    // from one said after; the region's own `textContent` setter, wrapped for the click, is where it is written.
    const said: { readonly text: string; readonly focus: Element | null }[] = []
    const live = document.querySelector('#live') as HTMLElement
    const text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent') as PropertyDescriptor
    Object.defineProperty(live, 'textContent', {
      configurable: true,
      get: () => text.get?.call(live),
      set: (value: string) => {
        said.push({ text: value.trim(), focus: document.activeElement })
        text.set?.call(live, value)
      },
    })
    try {
      await userEvent.click(undoButton() as HTMLButtonElement)
    } finally {
      delete (live as { textContent?: unknown }).textContent
    }
    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
    expect(picker().value).toBe('binary')
    expect(document.activeElement).toBe(view.contentDOM)
    expect(said.map((s) => s.text)).toEqual(['put back the program'])
    expect(said[0]?.focus, 'said once the focus is in the editor').toBe(view.contentDOM)
    expect(noticeText()).toBe('put back the program')
    await until(() => idle() && (segments()[0] ?? '').startsWith('λ 42'), 'the program’s compile')
  })

  /**
   * **A PICK'S UNDO GOES AT THE NEXT EDIT.** It puts back the whole document the pick replaced, so offered past an edit
   * it would throw that edit away with the example. Typed with real keys, as a user types.
   */
  it('withdraws its undo at the next edit, which the undo would throw away', async () => {
    await userEvent.click(button())
    await userEvent.click(item('is-even'))
    expect(undoButton()?.textContent).toBe('undo')
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    view.focus()
    await userEvent.keyboard('// kept')
    expect(view.state.doc.toString()).toBe(`${example('is-even').text}// kept`)
    expect(undoButton()).toBeNull()
    expect(noticeText()).toBe('')
  })

  /**
   * **AND AT THE NEXT ENCODING CHOSEN IN THE PICKER.** The undo puts back the encoding the pick replaced as well as the
   * text, so offered past a choice of encoding it would take that choice back.
   */
  it('withdraws its undo when an encoding is chosen, which the undo would take back', async () => {
    await userEvent.click(button())
    await userEvent.click(item('map-fold'))
    expect(undoButton()?.textContent).toBe('undo')
    await userEvent.selectOptions(picker(), 'binary')
    expect(picker().value).toBe('binary')
    expect(view.state.doc.toString()).toBe(example('map-fold').text)
    expect(undoButton()).toBeNull()
    expect(noticeText()).toBe('')
  })

  it('opens and picks by keys: Enter opens it, Tab moves on, Enter picks', async () => {
    button().focus()
    await userEvent.keyboard('{Enter}')
    expect(open()).toBe(true)
    expect(document.activeElement).toBe(items()[0])
    await userEvent.tab()
    expect(document.activeElement).toBe(items()[1])
    await userEvent.keyboard('{Enter}')
    expect(open()).toBe(false)
    expect(view.state.doc.toString()).toBe(example('closure').text)
    expect(noticeText()).toBe('opened the example a closure')
    expect(document.activeElement).toBe(button())
  })

  it('closes on Escape, with the focus back on its button', async () => {
    button().focus()
    await userEvent.keyboard('{Enter}')
    expect(open()).toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(open()).toBe(false)
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button())
  })

  /**
   * **AN UNDO LEFT TO RUN OUT GIVES THE FOCUS BACK TO `examples ▾`**, the control the pick was made from, and not to the
   * copies button, where the notice line leaves a copy's undo that went away (`NoticeAction`'s `fallback`). The one
   * long wait in this file, alone in its body for #99's reason: `NOTICE_MS` is a clock the app started at the pick,
   * which fake timers installed now could not reach.
   */
  it('gives the focus back to its button when the undo the focus is on runs out', async () => {
    await userEvent.click(button())
    await userEvent.click(item('arithmetic'))
    const undo = undoButton() as HTMLButtonElement
    expect(undo.textContent).toBe('undo')
    undo.focus()
    expect(document.activeElement, 'precondition: the focus is on the undo').toBe(undo)
    await until(() => undoButton() === null, 'the pick’s notice to run out')
    expect(document.activeElement).toBe(button())
  })

  /**
   * **WITH NO VIEW ON THE SOURCE, UNDO PUTS THE FOCUS ON `examples ▾`.** The undo's control is gone and an editor that
   * is not on the page takes no focus. A click puts the focus on the undo first, and the line's `fallback` and the
   * undo's own hand both put it on `examples ▾`; an undo activated where the focus is not on it, as assistive
   * technology can, is handed nothing by the line, and only the undo's own hand puts it there. Last in the file: the
   * source view stays closed.
   */
  it('puts the focus on its button after an undo, when no view shows the source', async () => {
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-leaf="source"] button.view-close') as Element,
    )
    await until(() => document.querySelector('[data-leaf="source"]') === null, 'the source view to close')
    const before = view.state.doc.toString()
    await userEvent.click(button())
    await userEvent.click(item('sum-to'))
    expect(view.state.doc.toString()).toBe(example('sum-to').text)
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe(before)
    expect(document.activeElement).toBe(button())

    // ACTIVATED WITHOUT THE FOCUS ON IT: a synthetic click, which moves no focus, stands for that activation here.
    await userEvent.click(button())
    await userEvent.click(item('sum-to'))
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement, 'precondition: the focus is on no control').toBe(document.body)
    undoButton()?.click()
    expect(view.state.doc.toString()).toBe(before)
    expect(document.activeElement).toBe(button())
  })
})
