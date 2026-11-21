import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { HEADER_ORDER } from '../../src/layout'
import { STYLE_IDS } from '../../src/skin'
import { chooseStyle, frames, mountAt, pressed, rem, toggle, token } from './harness'

/**
 * THE FOCUS RING OF A `views` TOGGLE IS WHOLE, WHATEVER IS BESIDE IT — read off the page's own pixels.
 *
 * The ring reaches 4px outside the button, the gap between toggles at a 16px root, so it meets each neighbour's edge
 * there and lies over it under a smaller root, where `style.css` draws the focused toggle over its neighbours: the
 * last case reads it at a 12px root.
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

/** The whole pixels along the middle half of a side from `from` to `to`. */
function along(from: number, to: number): number[] {
  const [a, b] = [Math.ceil(from + (to - from) / 4), Math.floor(to - (to - from) / 4)]
  return Array.from({ length: b - a }, (_, i) => a + i)
}

/**
 * How much of each side of `button`'s ring is the ring's colour: the pixels `along` the side, on a line a whole pixel
 * inside the 2px the ring covers, counted as `drawn of sampled`.
 */
async function ringOf(button: HTMLElement): Promise<Record<'top' | 'right' | 'bottom' | 'left', string>> {
  const colour = /^rgb\((.*)\)$/.exec(getComputedStyle(button).outlineColor)?.[1]
  if (colour === undefined)
    throw new Error(`the ring’s colour is not an rgb(): ${getComputedStyle(button).outlineColor}`)
  const at = await headerPixels()
  const r = button.getBoundingClientRect()
  // THE RING IS FROM 2px TO 4px OUTSIDE THE BOX, read on a whole pixel inside that band: the top and the bottom on the
  // row nearest the box, where a round corner's curve runs furthest along the side (on the outer row Paper's 5px
  // corners cut into the middle half of λ's top), and the left and right on the first whole column past -4px and 2px.
  const lines = {
    top: { y: Math.floor(r.top - 2) - 1 },
    bottom: { y: Math.ceil(r.bottom + 2) },
    left: { x: Math.ceil(r.left - 4) },
    right: { x: Math.ceil(r.right + 2) },
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
      // EVERY TOGGLE BUT CLIF'S PRESSED, THEN THE SOURCE AND rxm ALONE: a pressed toggle beside pressed ones, and each
      // unpressed one beside a pressed one, the source on λ's left and rxm on TM's right and CLIF's left.
      for (const shown of [
        ['source', 'lambda', 'tm', 'rxm'],
        ['source', 'rxm'],
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

  /**
   * **WHERE THE RING LIES OVER A NEIGHBOUR: A 12px ROOT**, a browser's "small" text, where the gap is 3px and the ring
   * reaches 4px. The toggle after the focused one would cover the ring's outer pixel there but for `style.css` drawing
   * the focused one over it. Both of the ring's pixel columns are read on each side that has a neighbour, at the device
   * pixels the page snaps the boxes to, and the precondition is that the neighbour's edge falls on one of them.
   */
  it('is whole beside each neighbour where the gap is narrower than the ring, at a 12px root', async () => {
    await chooseStyle('instrument')
    const root = document.documentElement
    root.style.fontSize = '12px'
    try {
      await frames()
      expect(rem(), 'precondition: the root is 12px').toBe(12)
      for (const [i, kind] of HEADER_ORDER.entries()) {
        await tabTo(toggle(kind))
        const ring = getComputedStyle(toggle(kind)).outlineColor
        const r = toggle(kind).getBoundingClientRect()
        const [before, after] = [HEADER_ORDER[i - 1], HEADER_ORDER[i + 1]]
        // EACH SIDE'S TWO RING COLUMNS, AND THE COLUMN OF THE NEIGHBOUR'S EDGE THAT FACES IT.
        const sides: ['left' | 'right', number[], string | undefined][] = [
          ['left', [Math.round(r.left) - 4, Math.round(r.left) - 3], before],
          ['right', [Math.round(r.right) + 2, Math.round(r.right) + 3], after],
        ]
        const read: Record<string, number[]> = {}
        for (const [side, columns, neighbour] of sides) {
          if (neighbour === undefined) continue
          const n = toggle(neighbour).getBoundingClientRect()
          const edge = side === 'left' ? Math.round(n.right) - 1 : Math.round(n.left)
          expect(columns, `precondition: ${neighbour}’s edge lies on ${kind}’s ring`).toContain(edge)
          const facing = side === 'left' ? 'borderRightColor' : 'borderLeftColor'
          expect(
            getComputedStyle(toggle(neighbour))[facing],
            'precondition: the edge is not the ring’s colour',
          ).not.toBe(ring)
          read[side] = columns
        }
        const at = await headerPixels()
        const colour = /^rgb\((.*)\)$/.exec(ring)?.[1]
        const ys = along(r.top, r.bottom)
        expect(ys.length, 'precondition: the side is sampled').toBeGreaterThan(5)
        const drawn = Object.fromEntries(
          Object.entries(read).map(([side, xs]) => [side, xs.map((x) => ys.filter((y) => at(x, y) === colour).length)]),
        )
        const whole = Object.fromEntries(Object.keys(read).map((side) => [side, [ys.length, ys.length]]))
        expect.soft(drawn, `the focus on ${kind}, pixels of the ring’s colour in each column`).toEqual(whole)
      }
    } finally {
      root.style.removeProperty('font-size')
    }
  })
})

/**
 * **EVERY CORNER OF EVERY TOGGLE TAKES THE STYLE'S `--radius`** (the view switcher style design), as the header's other
 * buttons do. The radius differs by style, so each is chosen in turn, and read as the page resolves the token.
 */
describe('the corners of a views toggle', () => {
  it('rounds all four corners of every toggle by the style’s --radius, in every style', async () => {
    const corners = (b: HTMLElement): string[] => {
      const style = getComputedStyle(b)
      return ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((corner) =>
        style.getPropertyValue(`border-${corner}-radius`),
      )
    }
    for (const style of STYLE_IDS) {
      await chooseStyle(style)
      const radius = token('--radius', 'border-top-left-radius')
      expect(Number.parseFloat(radius), `precondition: ${style}'s --radius rounds a corner`).toBeGreaterThan(0)
      expect(
        HEADER_ORDER.map((kind) => [kind, corners(toggle(kind))]),
        style,
      ).toEqual(HEADER_ORDER.map((kind) => [kind, [radius, radius, radius, radius]]))
    }
  })
})
