import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { STYLE_IDS } from '../../src/skin'
import { chooseStyle, mountAt, rem } from './harness'

/**
 * TERMINAL'S HEADER SITS CLOSER IN A WINDOW 85rem WIDE OR NARROWER — `style.css`'s rule beside `.bar`'s.
 *
 * The `views` toggles took Terminal's header past a 1280 px window: measured there before the rule (2026-10-12), it
 * needed 1,315.1 to 1,342.1 px across the presets, `settings` went to a second row, and the header was 91 px where
 * `main`'s was 46. With half the column gap it needs 1,227.1 to 1,254.1 px and is one row in every preset. Paper's
 * and Instrument's headers fitted and are not changed.
 *
 * **WHAT IS HELD IS THE GAP, AND NOT THE ROW IT BUYS.** Terminal draws the header in the machine's monospace, which
 * differs from one machine to the next, so how many pixels the header needs is this machine's figure and a runner's
 * may be another. The gap is the rule's own: half a rem in Terminal up to 85rem, a rem above it, and a rem in the
 * other two styles at any width.
 */

const gap = (): number =>
  Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>('header.bar') as HTMLElement).columnGap)

beforeAll(() => mountAt(1280, 896), 30_000)

describe('the gap between the header’s controls', () => {
  it('is half a rem in Terminal at 1280 px, and a rem in the other two styles', async () => {
    await page.viewport(1280, 896)
    expect(85 * rem(), 'precondition: 1280 px is no wider than 85rem').toBeGreaterThanOrEqual(1280)
    for (const style of STYLE_IDS) {
      await chooseStyle(style)
      expect(gap(), style).toBe(style === 'terminal' ? rem() / 2 : rem())
    }
  })

  it('is a rem in Terminal in a window wider than 85rem, and half of one at 85rem', async () => {
    await chooseStyle('terminal')
    await page.viewport(85 * rem() + 1, 896)
    expect(gap(), 'one pixel over 85rem').toBe(rem())
    await page.viewport(85 * rem(), 896)
    expect(gap(), 'at 85rem').toBe(rem() / 2)
    await page.viewport(1280, 896)
  })
})
