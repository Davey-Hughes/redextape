import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import {
  enterWidth,
  picker,
  pressToggle,
  rect,
  results,
  SHELL,
  segments,
  settled,
  stateIdle,
  tmLeaves,
  until,
  widthShown,
} from './harness'

/**
 * **THE RESULTS STRIP MARKS A PINNED WIDTH** (the TM width design, decision 23): the width box lives in a TM view,
 * so with none open the strip's `width N` is all the page says of the width, and a pinned run's overflow fault points
 * at a wider width or auto. Auto's fit stays `width N`. `2 + 3` under binary fits a 4-cell field, so auto runs it at 4
 * too, and only the mark tells the two apart. Measured on what is drawn: the strip cuts a long segment with an
 * ellipsis and keeps the whole text in the DOM, so a `Range` over the mark's own characters must lie inside the
 * segment's box. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

const SMALL = 'let x = 2; x + 3'

/** The TM leg's segment of the results strip, as an element. */
const tmSegmentEl = () => document.querySelectorAll<HTMLElement>('#results .segment')[2] as HTMLElement
const tmSegment = () => segments()[2] ?? ''

/** The box the characters `text` in `el`'s one text node are drawn in. */
function drawnBox(el: HTMLElement, text: string): DOMRect {
  const node = el.firstChild as Text
  const at = node.data.indexOf(text)
  expect(at, `"${text}" is in the segment`).toBeGreaterThanOrEqual(0)
  const range = document.createRange()
  range.setStart(node, at)
  range.setEnd(node, at + text.length)
  return range.getBoundingClientRect()
}

/** Press the TM toggle and wait until the page has `count` TM views. */
async function tmViews(count: number): Promise<void> {
  await pressToggle('tm')
  await until(() => tmLeaves().length === count, `${count} TM views`)
}

let view: EditorView

beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => stateIdle() && segments().length > 0, 'the first compile')
  await userEvent.selectOptions(picker(), 'binary')
  await settled(view, SMALL)
})

describe('the results strip, with no TM view open', () => {
  it('reads auto’s fit as `width N`, unmarked', async () => {
    expect(widthShown(tmLeaves()[0]), 'precondition: auto').toBe('auto')
    await tmViews(0)
    expect(document.querySelectorAll('.field-width').length, 'precondition: no width box on the page').toBe(0)
    expect(tmSegment()).toMatch(/^TM 5 · [\d,]+ transitions · width 4$/)
    await tmViews(1)
  })

  it('marks a pinned width, drawn in full on the strip', async () => {
    await enterWidth('4', tmLeaves()[0])
    expect(results().dataset.state, 'the choice starts a compile').toBe('running')
    await until(stateIdle, 'the compile at width 4')
    await tmViews(0)
    expect(document.querySelectorAll('.field-width').length, 'precondition: no width box on the page').toBe(0)
    expect(tmSegment()).toMatch(/^TM 5 · [\d,]+ transitions · width 4 \(pinned\)$/)

    const segment = tmSegmentEl()
    const box = rect(segment)
    const mark = drawnBox(segment, '(pinned)')
    expect(mark.width, 'the mark is drawn').toBeGreaterThan(0)
    expect(mark.left).toBeGreaterThanOrEqual(box.left)
    expect(mark.right, 'inside the segment’s box, not past a cut').toBeLessThanOrEqual(box.right + 0.5)
    expect(mark.top).toBeGreaterThanOrEqual(rect(results()).top)
    expect(mark.bottom).toBeLessThanOrEqual(rect(results()).bottom + 0.5)
    expect(segment.scrollWidth, 'the segment is not cut').toBeLessThanOrEqual(segment.clientWidth)
    expect(getComputedStyle(results()).opacity, 'the strip is not dimmed').toBe('1')
    expect(getComputedStyle(segment).visibility).toBe('visible')
  })
})
