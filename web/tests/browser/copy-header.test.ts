import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * A COPY'S VIEW HEADER FITS ONE ROW WHERE THE PROGRAM'S DOES, AND THE COPIES MENU'S NEW-COPY CONTROLS ARE STYLED.
 *
 * The check by hand's finding 8: in a half-width Explorer view the `copy · not linked` badge pushed `⋯` and `✕` onto a
 * second header row, where a view of the program the same width fits one; in a narrow split the title and the badge
 * each wrapped to two lines. `style.css` now breaks the header's line on the title alone and cuts the badge, and a
 * title with no room, with an ellipsis. Measured as `asm-pane.test.ts`'s geometry tests measure, with
 * `getBoundingClientRect`, and each case asserts first that a view of the program at the same width fits one row.
 *
 * Finding 7: *new asm copy* and *new TM copy* were the browser's own buttons, touching.
 *
 * Every gesture is a `userEvent` one. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

const SAMPLE = 'let x = 40; x + 2'

const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const host = (leaf: string) => document.querySelector<HTMLElement>(`.pane[data-leaf="${leaf}"]`) as HTMLElement
const rect = (el: Element | null) => (el as Element).getBoundingClientRect()
const menuOf = (button: HTMLElement): HTMLElement =>
  document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement

/**
 * Whether `pane`'s header is one row: its `⋯` and `✕` stand beside its title rather than below it — each overlaps the
 * title's band — and no part of its title wraps below the title's first line.
 */
function oneRow(pane: HTMLElement): boolean {
  const title = rect(pane.querySelector('.view-title'))
  const beside = (el: Element | null) => rect(el).top < title.bottom && rect(el).bottom > title.top
  const text = pane.querySelector('.view-title-text') ?? pane.querySelector('.view-title')
  // TWO LINES OF TEXT ARE AT LEAST TWICE THE FONT SIZE HIGH, WHATEVER THE LINE HEIGHT.
  const oneLine = rect(text).height < 2 * Number.parseFloat(getComputedStyle(text as Element).fontSize)
  return beside(pane.querySelector('button.view-more')) && beside(pane.querySelector('button.view-close')) && oneLine
}

/**
 * Whether `pane`'s title shows its whole text: its box is at least as wide as the text in it, so no ellipsis cuts it.
 * The text's own width is a `Range`'s, which the box's clipping does not narrow.
 */
function titleWhole(pane: HTMLElement): boolean {
  const text = pane.querySelector('.view-title-text') as HTMLElement
  const range = document.createRange()
  range.selectNodeContents(text)
  return rect(text).width + 0.01 >= range.getBoundingClientRect().width
}

/** Pick from the workspace menu with the pointer, and close it if the pick left it open. */
async function workspace(selector: string): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>('#workspace') as HTMLButtonElement
  await userEvent.click(button)
  await userEvent.click(document.querySelector<HTMLElement>(`#workspace-menu ${selector}`) as HTMLElement)
  if (menuOf(button).matches(':popover-open')) await userEvent.keyboard('{Escape}')
}

/** Open `pane`'s `⋯` menu with the pointer and pick the item `selector` names. */
async function viewMenu(pane: HTMLElement, selector: string): Promise<void> {
  const more = pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
  await userEvent.click(more)
  await until(() => menuOf(more).matches(':popover-open'), 'the view menu to open')
  await userEvent.click(menuOf(more).querySelector<HTMLElement>(selector) as HTMLElement)
}

beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SAMPLE } })
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
})

describe('a copy’s view header', () => {
  it('is one row in a half-width Explorer view, as the program’s view beside it is', async () => {
    const asm = host('asm-0')
    const tm = host('tm-0')
    // THE PRECONDITION: the two views are the same width, and the program's header fits one row there.
    expect(Math.abs(rect(asm).width - rect(tm).width)).toBeLessThan(2)
    expect(rect(asm).width).toBeLessThan(700)
    expect(oneRow(asm), 'the program’s asm view fits one row').toBe(true)
    expect(oneRow(tm), 'the program’s TM view fits one row').toBe(true)

    await viewMenu(asm, 'button.detach')
    await until(() => asm.querySelector('.view-status') !== null, 'the copy’s badge')
    const status = asm.querySelector<HTMLElement>('.view-status') as HTMLElement
    expect(status.textContent).toBe('copy · not linked')

    // THE WEB FONT IS WHAT THE WIDTHS BELOW ARE READ IN: a fallback face is narrower, and a title cut only once the
    // font arrives would pass against it.
    await document.fonts.ready
    expect(oneRow(asm), '`⋯` and `✕` on the title’s row').toBe(true)
    expect(titleWhole(asm), 'the title, whole, with the badge giving way').toBe(true)
    expect(
      Math.abs(rect(asm.querySelector('.view-header')).height - rect(tm.querySelector('.view-header')).height),
    ).toBeLessThan(1.5)
    // THE BADGE IS ONE LINE, ON THE TITLE'S ROW, AND ITS MEANING STAYS WHOLE IN ITS `title`.
    const title = rect(asm.querySelector('.view-title'))
    expect(rect(status).top).toBeLessThan(title.bottom)
    expect(rect(status).height).toBeLessThan(title.height + 1)
    expect(status.title).toBe('this view shows a copy, which is not linked to the program')
    expect(asm.querySelector<HTMLElement>('.view-title-text')?.title).toMatch(/^asm · copy \d+$/)
  })

  it('is one row in a narrow split, as the program’s view beside it is', async () => {
    await workspace('[data-preset="debugger"]')
    const copy = host('asm-0')
    await viewMenu(copy, 'button.view-split[data-dir="row"]')
    const before = new Set([...document.querySelectorAll<HTMLElement>('.pane[data-kind="asm"]')])
    await userEvent.click(
      menuOf(copy.querySelector('button.view-more') as HTMLElement).querySelector(
        'button[data-binding="asm:source"]',
      ) as HTMLElement,
    )
    const made = () =>
      [...document.querySelectorAll<HTMLElement>('.pane[data-kind="asm"]')].find((e) => !before.has(e) && e !== copy)
    await until(() => made() !== undefined, 'the split view of the program')
    const program = made() as HTMLElement

    expect(Math.abs(rect(copy).width - rect(program).width)).toBeLessThan(2)
    expect(rect(copy).width, 'a narrow split').toBeLessThan(330)
    expect(oneRow(program), 'the program’s view fits one row').toBe(true)
    expect(copy.querySelector('.view-status')).not.toBeNull()
    await document.fonts.ready
    expect(oneRow(copy), 'the copy’s title, badge, `⋯` and `✕` on one row').toBe(true)
    expect(titleWhole(copy), 'the title, whole, with the badge giving way').toBe(true)
    expect(
      Math.abs(rect(copy.querySelector('.view-header')).height - rect(program.querySelector('.view-header')).height),
    ).toBeLessThan(1.5)
  })
})

describe('a view narrower than its title', () => {
  /** The width of `text`'s own words, which a `Range` measures whatever its box clips. */
  const textWidth = (text: Element): number => {
    const range = document.createRange()
    range.selectNodeContents(text)
    return range.getBoundingClientRect().width
  }

  /**
   * **THE TITLE IS CUT, ON ONE LINE AND INSIDE THE VIEW**, where it used to wrap word by word. The view is made narrower
   * than its title's text by narrowing the page, which is asserted first; the program's view beside it is held to the
   * same rule.
   */
  it('cuts the title with an ellipsis on one line, inside the view', async () => {
    const views = [...document.querySelectorAll<HTMLElement>('.pane[data-kind="asm"]')]
    expect(views).toHaveLength(2)
    const titled = (v: HTMLElement) => v.querySelector('.view-title-text') as HTMLElement
    // EACH TITLE'S WIDTH ON ONE LINE, READ WHILE THE VIEWS STILL HAVE ROOM FOR IT.
    const whole = views.map((v) => textWidth(titled(v)))
    await page.viewport(480, 800)
    await until(() => views.every((v, i) => rect(v).width < (whole[i] ?? 0)), 'the page to narrow the views')
    for (const v of views) {
      const text = titled(v)
      expect(rect(text).height, 'the title is one line').toBeLessThan(
        2 * Number.parseFloat(getComputedStyle(text).fontSize),
      )
      expect(rect(v.querySelector('.view-title')).right, 'the title stays inside its view').toBeLessThanOrEqual(
        rect(v).right + 0.5,
      )
    }
    await page.viewport(1280, 800)
  })
})

describe('the copies menu’s new-copy controls', () => {
  it('are styled as the menu’s other controls are, and stand apart', async () => {
    await userEvent.click(document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement)
    await until(() => document.querySelector('.buffer-list .buffer-delete') !== null, 'a row’s delete control')
    const reference = getComputedStyle(document.querySelector('.buffer-list .buffer-delete') as Element)
    const asm = document.querySelector<HTMLElement>('.buffer-list button.new-asm') as HTMLElement
    const tm = document.querySelector<HTMLElement>('.buffer-list button.new-tm') as HTMLElement
    for (const b of [asm, tm]) {
      const style = getComputedStyle(b)
      for (const property of [
        'font-family',
        'font-size',
        'padding-top',
        'padding-left',
        'border-top-width',
        'border-top-style',
        'border-top-color',
        'border-radius',
        'background-color',
        'color',
      ]) {
        expect(style.getPropertyValue(property), `${b.className}: ${property}`).toBe(
          reference.getPropertyValue(property),
        )
      }
    }
    // SIDE BY SIDE ON ONE LINE, WITH A GAP BETWEEN THEM.
    expect(Math.abs(rect(asm).top - rect(tm).top)).toBeLessThan(1)
    expect(rect(tm).left - rect(asm).right).toBeGreaterThanOrEqual(4)
    await userEvent.keyboard('{Escape}')
  })
})
