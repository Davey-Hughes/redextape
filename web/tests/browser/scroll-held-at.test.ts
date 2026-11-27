import { expect, it } from 'vitest'
import { frame, scrolled, scrollHeldAt, until } from './harness'

/**
 * `harness.ts`'s `scrollHeldAt`, on a plain box that follows nothing, so a case makes by hand the move a following
 * box's draw makes. A `window` capture listener withholds a write's `scroll` event: an element's `scroll` does not
 * bubble but does pass `window` on its way down, so the box's own listeners, the helper's among them, never run.
 */

/**
 * A box 100 px high over 1000 px of content, at 0, so it scrolls from 0 to 900; `overflow` visible does not scroll.
 * **A WRITTEN PLACE IS READ TO THE PIXEL**: Firefox lands a write on a device pixel, so a box written to 300 can read a
 * fraction off it, which the helper's own one-pixel tolerance allows.
 */
function box(overflow = 'auto'): HTMLElement {
  const el = document.createElement('div')
  el.className = 'held-box'
  el.style.cssText = `height: 100px; width: 100px; overflow: ${overflow}`
  const inner = document.createElement('div')
  inner.style.height = '1000px'
  el.append(inner)
  document.body.append(el)
  return el
}

/** Withhold `el`'s `scroll` events until `release`; `withheld` settles once one has been. */
function withhold(el: HTMLElement): { withheld: Promise<void>; release: () => void } {
  let heard = () => {}
  const withheld = new Promise<void>((r) => {
    heard = r
  })
  const stop = (e: Event) => {
    if (e.target !== el) return
    e.stopImmediatePropagation()
    heard()
  }
  window.addEventListener('scroll', stop, { capture: true })
  return { withheld, release: () => window.removeEventListener('scroll', stop, { capture: true }) }
}

it('reads a write as held only once its own scroll event has come', async () => {
  const el = box()
  try {
    expect(scrollHeldAt(el, 300), 'the call that writes').toBe(false)
    expect(el.scrollTop, 'written').toBeCloseTo(300, 0)
    expect(scrollHeldAt(el, 300), 'in place, in the task that wrote').toBe(false)
    await scrolled(el)
    expect(scrollHeldAt(el, 300), 'once the event has come').toBe(true)
  } finally {
    el.remove()
  }
})

it('holds at once a box already in place, and one at its end for a place past it', () => {
  const el = box()
  try {
    expect(scrollHeldAt(el, 0), 'at 0').toBe(true)
    el.scrollTop = 900
    expect(scrollHeldAt(el, 5000), 'at the end').toBe(true)
  } finally {
    el.remove()
  }
})

it('throws at once, naming the box and the place, for a place the box cannot reach', () => {
  const el = box()
  const flat = box('visible')
  try {
    expect(() => scrollHeldAt(el, -50)).toThrow(
      /^scrollHeldAt: \.held-box cannot reach -50: it reads 0 straight after the write, and scrolls from 0 to 900$/,
    )
    expect(() => scrollHeldAt(el, Number.NaN)).toThrow(/^scrollHeldAt: \.held-box cannot reach NaN: it reads 0 /)
    expect(() => scrollHeldAt(flat, 300)).toThrow(/^scrollHeldAt: \.held-box cannot reach 300: it reads 0 /)
  } finally {
    el.remove()
    flat.remove()
  }
})

it("throws, naming the box, when its write's event has not come in 30 frames, and the next call holds", async () => {
  const el = box()
  const held = withhold(el)
  try {
    const settled = until(() => scrollHeldAt(el, 300))
    // Settled first, so the message is matched against what the box reads once the helper has given up on it.
    await settled.catch(() => undefined)
    expect(el.scrollTop, 'written').toBeCloseTo(300, 0)
    await expect(settled).rejects.toThrow(
      `scrollHeldAt: no scroll event has come for .held-box's write in 30 frames: it reads ${el.scrollTop}, is in the document and has 1 client rects. `,
    )
    expect(scrollHeldAt(el, 300), 'the call after the throw').toBe(true)
  } finally {
    held.release()
    el.remove()
  }
})

let crossed: HTMLElement | undefined

it("a case whose write's event is withheld past the helper's 30 frames, with no until to report it", async () => {
  crossed = box()
  const held = withhold(crossed)
  try {
    expect(scrollHeldAt(crossed, 300), 'the call that writes').toBe(false)
    await held.withheld
  } finally {
    held.release()
  }
  // Past the count's bound, so a wait this case left behind would throw in the next one rather than only read false.
  for (let i = 0; i < 40; i++) await frame()
})

it('holds at once, in the next case, the box whose event that case did not hear', () => {
  try {
    if (crossed === undefined) throw new Error('the case before did not run')
    expect(crossed.scrollTop, 'where the case before wrote').toBeCloseTo(300, 0)
    expect(scrollHeldAt(crossed, 300)).toBe(true)
  } finally {
    crossed?.remove()
  }
})

it("writes again when the box is put back before its write's event, and holds once the new write's event has come", async () => {
  const el = box()
  try {
    expect(scrollHeldAt(el, 300), 'the call that writes').toBe(false)
    // Put back in the task that wrote, as a following box's draw does: the event that comes reads as this write's.
    el.scrollTop = 0
    await scrolled(el)
    expect(scrollHeldAt(el, 300), 'the call that finds the box put back').toBe(false)
    expect(el.scrollTop, 'written again').toBeCloseTo(300, 0)
    expect(scrollHeldAt(el, 300), 'in place, in the task that wrote again').toBe(false)
    await scrolled(el)
    expect(scrollHeldAt(el, 300), "once the new write's event has come").toBe(true)
  } finally {
    el.remove()
  }
})
