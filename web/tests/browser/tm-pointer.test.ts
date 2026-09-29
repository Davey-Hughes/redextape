import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * **A POINTER, NOT `HTMLElement.click()`** (spec amendment 18). The rule table's rows and the program level's rows
 * are drawn afresh on every draw, and a view draws when it takes the focus, so a row the pointer went down on can be
 * replaced before it comes up — and the browser fires no `click` on an element that has left the page between the
 * two. `.click()` is one synthetic event on one element and cannot see that. Each gesture here is `userEvent.click`,
 * a Playwright pointer: `mousedown` and `mouseup` at the element's centre, and whatever `click` the browser derives.
 *
 * **THE FOCUS STARTS OUTSIDE THE GRID**, in the source editor, where a reader who has just typed has it: that first
 * click is the one a focus change moves under the pointer.
 */

let view: EditorView

const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'

const pane = () => document.querySelector('[data-leaf="tm-0"]') as HTMLElement
const table = () => pane().querySelector('.state-table') as HTMLElement
const diagram = () => pane().querySelector('[data-panel="diagram"]') as HTMLElement
const programGrid = () => diagram().querySelector('.program-scroll') as HTMLElement
const status = () => pane().querySelector('.tm-status')?.textContent ?? ''
const control = (label: string) =>
  [...pane().querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
/** Whether `el` lies wholly inside `box` on screen, so a pointer aimed at its centre lands on it. */
const within = (el: Element, box: Element) => {
  const a = el.getBoundingClientRect()
  const b = box.getBoundingClientRect()
  return a.height > 0 && a.top >= b.top && a.bottom <= b.bottom && a.left >= b.left && a.right <= b.right
}
/** Whether an element is drawn: `hidden` is not enough, since an author `display` can outrank it. */
const drawn = (sel: string) => getComputedStyle(diagram().querySelector(sel) as HTMLElement).display !== 'none'

beforeAll(async () => {
  await page.viewport(1280, 2400)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: FACT3 } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the app to settle')
  await until(() => table().querySelector('.state-row') !== null, 'the rule table to draw')
  await until(() => diagram().querySelector('.program-row') !== null, 'the program level to draw')
})

describe('a pointer on the rows a draw rebuilds', () => {
  it('links the rule-table row the first click lands on, with the focus coming from the source editor', async () => {
    view.focus()
    expect(view.hasFocus).toBe(true)
    // An instruction's entry state, which a construct built: a runtime routine's — `halt`, where the run ends and the
    // table opens — links nothing.
    const row = [...table().querySelectorAll<HTMLElement>('.state-row.is-state')].find(
      (r) => /^pc\d+$/.test(r.textContent ?? '') && within(r, table()) && !r.classList.contains('is-linked'),
    ) as HTMLElement
    expect(row).toBeDefined()
    // BY ITS PLACE IN THE TABLE, NOT BY THE ELEMENT: every draw after the click replaces it.
    const index = row.getAttribute('aria-rowindex')
    const linked = () => table().querySelector(`[aria-rowindex="${index}"]`)?.classList.contains('is-linked') === true
    await userEvent.click(row)
    await until(linked, 'the row clicked to be linked')
    expect(document.activeElement).toBe(table())
    // A KEY AFTER THE CLICK SHOWS WHERE IT IS: the active row's mark is drawn only while the grid is
    // `:focus-visible`, and a reader who clicked and then pressed an arrow has to see the row the next Enter links.
    await userEvent.keyboard('{ArrowDown}')
    expect(table().matches(':focus-visible')).toBe(true)
    const active = table().querySelector('.state-row.is-active') as HTMLElement
    // `--row-active`'s ring is the only mark with a 2px spread.
    expect(getComputedStyle(active).boxShadow).toContain('0px 0px 0px 2px')
  })

  it("links a program-level row's construct on the first click, with the focus coming from the source editor", async () => {
    view.focus()
    expect(view.hasFocus).toBe(true)
    const row = [...diagram().querySelectorAll<HTMLElement>('.program-row')].find(
      (r) =>
        r.querySelector('.program-name') !== null && within(r, programGrid()) && !r.classList.contains('is-linked'),
    ) as HTMLElement
    expect(row).toBeDefined()
    const name = row.querySelector('.program-name')?.textContent
    const linked = () =>
      [...diagram().querySelectorAll('.program-row')]
        .find((r) => r.querySelector('.program-name')?.textContent === name)
        ?.classList.contains('is-linked') === true
    await userEvent.click(row)
    await until(linked, `${name} to be linked`)
    expect(document.activeElement).toBe(programGrid())
    // The same after a key, for the program level's own mark: an outline on its active row.
    await userEvent.keyboard('{ArrowDown}')
    expect(programGrid().matches(':focus-visible')).toBe(true)
    const active = diagram().querySelector('.program-row.is-active') as HTMLElement
    expect(getComputedStyle(active).outlineStyle).not.toBe('none')
  })

  describe('inside cmpeq', () => {
    // Inside `cmpeq`, where the current instruction opens onto its sub-steps and so has a show states. REACHED IN A
    // HOOK: 1,732 clicks, a full redraw each, whose time is the machine's, and on the slower CI runner a body that
    // walked here came within a second or two of Vitest's 15 s cap. See `intoCmpeq` in `state-diagram.test.ts`.
    beforeAll(async () => {
      control('↺')?.click()
      for (let i = 0; i < 20_000 && !/^cmp/.test(status()); i += 1) control('▶')?.click()
      await until(() => /^cmp/.test(status()), 'the machine to be inside cmpeq')
    })

    it('shows the local level on a click on show states, and hands the focus to it', async () => {
      // THE GRID TAKES THE FOCUS FROM ELSEWHERE, so the click below comes with the grid already focused. The button
      // is found AFTER that focus, not before: taking it draws the view and replaces every row, and `userEvent.click`
      // on an element no longer in the document throws (`Cannot read properties of undefined (reading 'includes')`)
      // before any pointer event is sent.
      view.focus()
      programGrid().focus()
      expect(document.activeElement).toBe(programGrid())
      const show = diagram().querySelector<HTMLButtonElement>('.program-show') as HTMLButtonElement
      expect(within(show, programGrid())).toBe(true)
      await userEvent.click(show)
      await until(() => diagram().querySelector('.local-node') !== null, 'the local level to draw')
      expect(drawn('.local-level')).toBe(true)
      expect(drawn('.program-level')).toBe(false)
      const focused = document.activeElement as HTMLElement
      expect(focused).not.toBe(document.body)
      expect(focused.classList.contains('local-node')).toBe(true)
      expect(focused.tabIndex).toBe(0)
    })

    it('does the same with the focus coming from the source editor', async () => {
      const choice = (value: string) =>
        [...diagram().querySelectorAll<HTMLButtonElement>('.diagram-mode')].find((b) => b.dataset.value === value)
      choice('program')?.click()
      expect(drawn('.program-level')).toBe(true)
      view.focus()
      expect(view.hasFocus).toBe(true)
      const show = diagram().querySelector<HTMLButtonElement>('.program-show') as HTMLButtonElement
      expect(within(show, programGrid())).toBe(true)
      await userEvent.click(show)
      await until(() => drawn('.local-level'), 'the local level to show')
      expect(drawn('.program-level')).toBe(false)
      // THE CLICK TOOK THE FOCUS INTO THE LEVEL IT LEFT, as a pointer on a focusable grid does, and the level
      // handed it on: it is on the local level's tab stop, not left in the editor and not dropped to the page.
      const focused = document.activeElement as HTMLElement
      expect(focused.classList.contains('local-node')).toBe(true)
      expect(focused.tabIndex).toBe(0)
    })

    /**
     * *SHOW STATES* IS THE BUTTON'S CLICK, NOT THE ROW'S: the sub-steps row it sits on does not become the active row,
     * so the program level shown again has its cursor where the reader left it.
     */
    it('leaves the active row where it was on a click on show states', async () => {
      const choice = (value: string) =>
        [...diagram().querySelectorAll<HTMLButtonElement>('.diagram-mode')].find((b) => b.dataset.value === value)
      const active = () =>
        document
          .getElementById(programGrid().getAttribute('aria-activedescendant') ?? '')
          ?.closest('.program-row')
          ?.querySelector('.program-name')?.textContent
      choice('program')?.click()
      expect(drawn('.program-level')).toBe(true)
      await userEvent.click(diagram().querySelector('.program-row[aria-current="step"]') as HTMLElement)
      expect(active(), 'the current row, clicked').toBe('pc4')
      await userEvent.click(diagram().querySelector('.program-show') as HTMLElement)
      await until(() => drawn('.local-level'), 'the local level to show')
      choice('program')?.click()
      expect(drawn('.program-level')).toBe(true)
      expect(active(), 'not the sub-steps row the button sits on').toBe('pc4')
    })
  })
})
