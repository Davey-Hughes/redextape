import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { NARROW_WINDOW, NARROW_WINDOW_REM } from '../../src/app-header'
import { mountAt, until } from './harness'

/**
 * THE WIDTH AT WHICH THE `views` TOGGLES ARE HIDDEN, TO THE PIXEL — the view layouts spec §6.1. Two things hide
 * them: the `hidden` attribute `main.ts` sets from `app-header.ts`'s `NARROW_WINDOW`, and `style.css`'s media rule,
 * for the paint before `main.ts` runs. A stylesheet imports nothing, so the rule's width is written a second time.
 *
 * **EACH IS READ AT THE LAST WIDTH THAT HIDES AND AT THE FIRST THAT DOES NOT**, so a width that differs from the
 * other's by a pixel fails. The other files that narrow the window do it to 390, 414 and 600 px: with the rule at
 * 30rem, or the attribute's query at 38rem, every one of them passed.
 *
 * `tests/node/app-header.test.ts` holds the rule's text to the query's; this holds what each does on the page.
 */

const group = (): HTMLElement => document.querySelector('#views-shown') as HTMLElement
/** Whether the stylesheet alone draws the group: read with the attribute taken off, and put back. */
const drawnByTheRule = (): boolean => {
  const hidden = group().hidden
  group().hidden = false
  const drawn = getComputedStyle(group()).display !== 'none'
  group().hidden = hidden
  return drawn
}

describe('the views toggles, at the width that hides them', () => {
  // A REM IS 16 PX HERE, AS AT A BROWSER'S DEFAULT TEXT SIZE, which the first case holds before it reads a width.
  const edge = NARROW_WINDOW_REM * 16

  beforeAll(() => mountAt(1280, 896))

  it.each([
    [edge + 1, false],
    [edge, true],
    [edge + 1, false],
  ] as const)('at %i px: hidden %s, by the attribute and by the stylesheet’s rule alike', async (width, hidden) => {
    await page.viewport(width, 896)
    expect(window.innerWidth, 'precondition: the window is the width asked for').toBe(width)
    expect(matchMedia(`(max-width: ${edge}px)`).matches, 'precondition: a rem is 16 px in this window').toBe(
      matchMedia(NARROW_WINDOW).matches,
    )
    await until(() => group().hidden === hidden, `the attribute to follow the window to ${width} px`)
    expect(drawnByTheRule(), `the stylesheet’s rule at ${width} px`).toBe(!hidden)
  })
})
