import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { STYLE_IDS } from '../../src/skin'
import { chooseStyle, mountAt, rem } from './harness'

/**
 * TERMINAL'S AND PAPER'S HEADERS SIT CLOSER OVER 30rem, TERMINAL'S UP TO 85rem — `style.css`'s rules beside `.bar`'s.
 * At `.bar`'s gap the `views` toggles would take Terminal's header past a 1280 px window (the view-layouts design's
 * §6.1, `docs/superpowers/specs/2026-10-11-view-layouts-design.md`), and Paper's where its face is DejaVu Sans. At
 * 30rem and narrower the phone's rule gives every style the same gap.
 *
 * **WHAT IS HELD IS THE GAP, AND NOT THE ROW IT BUYS.** Both draw the header in the machine's faces, which differ from
 * one machine to the next, so the row is held by `clif-header.test.ts` against the header without the CLIF toggle,
 * and the gap here.
 */

/** The header's column gaps, in rem: `style.css`'s `--bar-column-gap` on `.bar`, in Terminal's rule and in Paper's. */
const FULL = 0.8125
const CLOSER = 0.3125
const PAPER = 0.5625

const gap = (): number =>
  Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>('header.bar') as HTMLElement).columnGap)

beforeAll(() => mountAt(1280, 896), 30_000)

describe('the gap between the header’s controls', () => {
  it('is the closer gap in Terminal at 1280 px, Paper’s own in Paper, and the full gap in Instrument', async () => {
    await page.viewport(1280, 896)
    expect(85 * rem(), 'precondition: 1280 px is no wider than 85rem').toBeGreaterThanOrEqual(1280)
    for (const style of STYLE_IDS) {
      await chooseStyle(style)
      expect(gap(), style).toBe((style === 'terminal' ? CLOSER : style === 'paper' ? PAPER : FULL) * rem())
    }
  })

  it('is the full gap in Terminal in a window wider than 85rem, and the closer one at 85rem', async () => {
    await chooseStyle('terminal')
    await page.viewport(85 * rem() + 1, 896)
    expect(gap(), 'one pixel over 85rem').toBe(FULL * rem())
    await page.viewport(85 * rem(), 896)
    expect(gap(), 'at 85rem').toBe(CLOSER * rem())
    await page.viewport(1280, 896)
  })

  it('is half a rem in every style at 30rem, and Terminal’s and Paper’s own one pixel wider', async () => {
    await page.viewport(30 * rem(), 896)
    for (const style of STYLE_IDS) {
      await chooseStyle(style)
      expect(gap(), `${style} at 30rem`).toBe(rem() / 2)
    }
    await page.viewport(30 * rem() + 1, 896)
    await chooseStyle('terminal')
    expect(gap(), 'Terminal one pixel over 30rem').toBe(CLOSER * rem())
    await chooseStyle('paper')
    expect(gap(), 'Paper one pixel over 30rem').toBe(PAPER * rem())
    await page.viewport(1280, 896)
  })
})
