import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { HEADER_ORDER } from '../../src/layout'
import { STYLE_IDS } from '../../src/skin'
import { chooseStyle, frames, mountAt, pressed, toggle } from './harness'

/**
 * THE FOCUS RING OF A `views` TOGGLE IS WHOLE, WHATEVER IS BESIDE IT — read off the page's own pixels.
 *
 * The ring is an outline 2px outside the button, and the four buttons are joined, so on each inner side it lies over
 * the neighbour's edge. A pressed toggle is positioned and filled, and would be painted over that part of the ring but
 * for `style.css` drawing the focused toggle over its neighbours.
 *
 * **THE PIXELS ARE THE ASSERTION.** A screenshot of the header is read back, and along the middle half of each of the
 * ring's four sides every pixel is asked to be the ring's colour, which is the button's computed `outline-color`. The
 * computed style alone would say a ring is drawn while a side is covered.
 *
 * **IN A WINDOW 1000 px WIDE**: the tester's page is drawn scaled where it is wider than the browser's own window, and
 * a ring 2px wide does not survive that. The case asserts that the screenshot is a pixel to a CSS pixel.
 *
 * **THE KEYBOARD MOVES THE FOCUS**, so that `:focus-visible` matches: Tab, from the control before the group.
 */

/** The header's pixels: a reader of the colour at a point of the page, as `r, g, b`. */
async function headerPixels(): Promise<(x: number, y: number) => string> {
  const header = document.querySelector<HTMLElement>('header.bar') as HTMLElement
  const base64 = await page.screenshot({ element: header, save: false })
  const bytes = Uint8Array.from(atob(base64.replace(/^data:image\/png;base64,/, '')), (c) => c.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  const box = header.getBoundingClientRect()
  expect(bitmap.width, 'precondition: the screenshot is a pixel to a CSS pixel').toBe(Math.round(box.width))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('no 2d context to read the screenshot with')
  context.drawImage(bitmap, 0, 0)
  const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data
  return (x, y) => {
    const at = (Math.floor(y - box.top) * bitmap.width + Math.floor(x - box.left)) * 4
    return `${data[at]}, ${data[at + 1]}, ${data[at + 2]}`
  }
}

/**
 * How much of each side of `button`'s ring is the ring's colour: the pixels along the middle half of the side, on a
 * line a whole pixel inside the 2px the ring covers, counted as `drawn of sampled`.
 */
async function ringOf(button: HTMLElement): Promise<Record<'top' | 'right' | 'bottom' | 'left', string>> {
  const colour = /^rgb\((.*)\)$/.exec(getComputedStyle(button).outlineColor)?.[1]
  if (colour === undefined)
    throw new Error(`the ring’s colour is not an rgb(): ${getComputedStyle(button).outlineColor}`)
  const at = await headerPixels()
  const r = button.getBoundingClientRect()
  // THE RING IS FROM 2px TO 4px OUTSIDE THE BOX: the first whole pixel past 2px on the far sides, past -4px on the near.
  const lines = {
    top: { y: Math.ceil(r.top - 4) },
    bottom: { y: Math.ceil(r.bottom + 2) },
    left: { x: Math.ceil(r.left - 4) },
    right: { x: Math.ceil(r.right + 2) },
  }
  const along = (from: number, to: number): number[] => {
    const [a, b] = [Math.ceil(from + (to - from) / 4), Math.floor(to - (to - from) / 4)]
    return Array.from({ length: b - a }, (_, i) => a + i)
  }
  const count = (points: [number, number][]): string =>
    `${points.filter(([x, y]) => at(x, y) === colour).length} of ${points.length}`
  return {
    top: count(along(r.left, r.right).map((x) => [x, lines.top.y])),
    bottom: count(along(r.left, r.right).map((x) => [x, lines.bottom.y])),
    left: count(along(r.top, r.bottom).map((y) => [lines.left.x, y])),
    right: count(along(r.top, r.bottom).map((y) => [lines.right.x, y])),
  }
}

/** Tab to `button` from the control before the group. */
async function tabTo(button: HTMLElement): Promise<void> {
  ;(document.querySelector('#workspace') as HTMLElement).focus()
  for (let n = 0; n < 6 && document.activeElement !== button; n += 1) await userEvent.keyboard('{Tab}')
  expect(document.activeElement, 'precondition: Tab reached the toggle').toBe(button)
  expect(button.matches(':focus-visible'), 'precondition: the focus came by the keyboard').toBe(true)
  await frames()
}

beforeAll(() => mountAt(1000, 700))

describe('the focus ring of a views toggle', () => {
  it.each(STYLE_IDS)(
    'is whole on every side of every toggle in %s, pressed or not, beside pressed or not',
    async (style) => {
      await chooseStyle(style)
      await document.fonts.ready
      // ALL FOUR PRESSED, THEN THE SOURCE AND TM ALONE: a pressed toggle beside pressed ones, and each unpressed one
      // beside a pressed one, asm on its left and λ on its right.
      for (const shown of [
        ['source', 'asm', 'lambda', 'tm'],
        ['source', 'tm'],
      ]) {
        for (const kind of HEADER_ORDER) if (pressed().includes(kind) !== shown.includes(kind)) toggle(kind).click()
        expect(pressed(), 'precondition: the toggles pressed').toEqual(shown)
        for (const kind of HEADER_ORDER) {
          await tabTo(toggle(kind))
          const ring = await ringOf(toggle(kind))
          const sampled = (side: keyof typeof ring): number => Number(ring[side].split(' of ')[1])
          expect(sampled('top'), 'precondition: the top side is sampled').toBeGreaterThan(5)
          expect(sampled('left'), 'precondition: the left side is sampled').toBeGreaterThan(5)
          const whole = Object.fromEntries(
            (Object.keys(ring) as (keyof typeof ring)[]).map((side) => [side, `${sampled(side)} of ${sampled(side)}`]),
          )
          // SOFT, SO EVERY RING THAT IS CUT IS REPORTED, not the first one alone.
          expect.soft(ring, `${style}, ${shown.join(' and ')} pressed, the focus on ${kind}`).toEqual(whole)
        }
      }
      for (const kind of HEADER_ORDER) if (!pressed().includes(kind)) toggle(kind).click()
    },
  )
})
