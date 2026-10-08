import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * **THE ONE STEP BAR ON A PHONE'S SCREEN** — the `steps` switch at `bar` (`step-bar.ts`), in the two presets that put
 * it there, at 320px and 390px, under a short step line and a long one. The bar was one row that never wrapped: at
 * 320px it widened the page, at 390px `fact(4)`'s line pushed `keep recording` past the page's right edge, and where
 * the page held, the step text was squeezed into a column a few characters wide. What is held is that each of its
 * boxes lies inside the page at a phone's width, and that at a desktop's width the bar is still one row with the old
 * bar's two gaps. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

type Preset = 'debugger' | 'stage'

const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const buttonOf = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`) as HTMLButtonElement
const menuOf = (id: string) => document.getElementById(buttonOf(id).getAttribute('aria-controls') ?? '') as HTMLElement
const bar = () => document.querySelector<HTMLElement>('#step-bar') as HTMLElement
const title = () => bar().querySelector<HTMLElement>('.step-bar-title') as HTMLElement
const step = () => bar().querySelector<HTMLElement>('.step') as HTMLElement
const extend = () => bar().querySelector<HTMLButtonElement>('.extend') as HTMLButtonElement
const restart = () => bar().querySelector<HTMLButtonElement>('button[aria-label="back to the oldest kept step"]')
const stepText = () => step().textContent ?? ''
const shown = (el: Element) => el.getClientRects().length > 0

/** Every box the bar draws, in the order it draws them: the title, each control, and the step text. */
const drawn = (): HTMLElement[] =>
  [...bar().querySelectorAll<HTMLElement>('.step-bar-title, button, select, .step')].filter(shown)
const nameOf = (el: HTMLElement): string =>
  el === title()
    ? 'the title'
    : el === step()
      ? 'the step text'
      : (el.getAttribute('aria-label') ?? el.textContent ?? '')
const centreOf = (el: Element): number => {
  const box = el.getBoundingClientRect()
  return (box.top + box.bottom) / 2
}
/** A spacing token in pixels, as the page resolves it. */
const space = (token: string): number => {
  const probe = document.createElement('div')
  probe.style.width = `var(${token})`
  document.body.append(probe)
  const width = probe.getBoundingClientRect().width
  probe.remove()
  return width
}
/** How many lines a box's text is set on: one per distinct top among its text's line boxes. */
const linesOf = (el: Element): number => {
  const range = document.createRange()
  range.selectNodeContents(el)
  return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
}

/** Put the workspace on `preset`, by the menu's own buttons. */
const presetOf = (preset: string): void => {
  buttonOf('workspace').click()
  menuOf('workspace').querySelector<HTMLButtonElement>(`[data-preset="${preset}"]`)?.click()
  if (menuOf('workspace').matches(':popover-open')) menuOf('workspace').hidePopover()
}

beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(idle, 'the first compile')
})

/**
 * Put the page at `width` by `height` on `preset`, with the bar in view, and **ASSERT THE STATE THE CASE MEANS TO
 * MEASURE** before it measures anything: the preset, the bar on the page and naming the λ view, and the line under
 * test. A probe that skipped this would report whatever the previous case left behind.
 */
async function at(preset: Preset, line: Line, width: number, height: number): Promise<void> {
  presetOf(preset)
  await page.viewport(width, height)
  expect(innerWidth, 'precondition: the page’s width').toBe(width)
  expect(buttonOf('workspace').textContent, 'precondition: the preset').toMatch(new RegExp(`^${preset}`, 'i'))
  expect(bar().hidden, 'precondition: the bar is on the page').toBe(false)
  expect(title().textContent, 'precondition: the bar drives the λ view').toBe('λ · program')
  line.holds()
  // VERTICALLY ONLY: a sideways scroll would bring a control past the page's edge back into view, which is the
  // defect this file holds, and `elementFromPoint` sees only what is in the viewport.
  scrollTo(0, scrollY + bar().getBoundingClientRect().top)
  expect(scrollX, 'precondition: the page is not scrolled sideways').toBe(0)
  const box = bar().getBoundingClientRect()
  expect(box.top, 'precondition: the bar’s top is in view').toBeGreaterThanOrEqual(0)
  expect(box.bottom, 'precondition: the bar’s bottom is in view').toBeLessThanOrEqual(innerHeight)
}

type Line = { readonly example: string; readonly name: string; readonly long: boolean; holds(): void }

/**
 * **THE TWO LINES THE BAR CARRIES.** `sum_to(5)` ends, so its line is the step count alone and the continue button is
 * gone. `fact(4)` fills the λ leg's history, and once `keep recording` has filled it again the ring has dropped its
 * oldest steps, so its line names both, and `keep recording` is on the bar. **THE ONE `keep recording` IS WHAT MAKES
 * THE LINE LONG**: a ring keeps the whole of its first recording (`History`'s `#evict`), whose line names no oldest
 * kept step.
 */
const LINES: readonly Line[] = [
  {
    example: 'sum-to',
    name: 'sum_to(5)’s short line',
    long: false,
    holds: () => {
      expect(stepText(), 'precondition: the short line').toMatch(/^step [\d,]+ of [\d,]+$/)
      expect(shown(extend()), 'precondition: no continue button').toBe(false)
    },
  },
  {
    example: 'fact',
    name: 'fact(4)’s long line',
    long: true,
    holds: () => {
      expect(stepText(), 'precondition: the long line').toMatch(/history is full \(oldest kept: /)
      expect(extend().textContent, 'precondition: the continue button').toBe('keep recording')
      expect(shown(extend()), 'precondition: the continue button is drawn').toBe(true)
    },
  },
]

const PRESETS: readonly Preset[] = ['debugger', 'stage']
const PHONES = [
  [320, 568],
  [390, 844],
] as const
const CASES = PRESETS.flatMap((preset) => PHONES.map(([width, height]) => [preset, width, height] as const))

describe.each(LINES)('the step bar, under $name', (line) => {
  /**
   * Pick the line's example, and wait for its line on the bar and then for the run's result, so nothing on the page
   * moves while it is measured.
   *
   * **TWO WAITS, NOT ONE.** The λ line is final well before the other legs' result arrives. Measured on 2026-10-01
   * under a 25% CPU quota, in a run that timed the two separately, `fact(4)`'s line was final 3.1s after the pick's
   * clicks and its result came 10.2s after them, past the 10s `until` gives one wait. Split, each has its own, and the
   * two together stay inside the hook's own 30s.
   */
  beforeAll(async () => {
    await page.viewport(1280, 800)
    presetOf('debugger')
    const before = stepText()
    await userEvent.click(buttonOf('examples'))
    await userEvent.click(menuOf('examples').querySelector(`button[data-example="${line.example}"]`) as HTMLElement)
    // THE LINE BEFORE THE PICK IS EXCLUDED BY NAME: the program it replaced also ends, in a line the short one's
    // pattern matches.
    await until(
      () =>
        stepText() !== before &&
        (line.long ? stepText().includes('history is full') : /^step [\d,]+ of [\d,]+$/.test(stepText())),
      `${line.name} on the bar`,
    )
    await until(idle, `${line.name}’s run to its result`)
    if (!line.long) return
    extend().click()
    await until(() => /history is full \(oldest kept: /.test(stepText()), `${line.name}, kept recording`)
  })

  /**
   * **THE PAGE DOES NOT SCROLL SIDEWAYS, AND EVERY BOX THE BAR DRAWS IS ON IT.** The page's width first, since that
   * is what a phone shows; then each box, since a box can run past the edge of a bar that clips or scrolls rather than
   * widening the page. `keep recording` is held to be CLICKABLE, not only inside the page: `elementFromPoint` at its
   * centre is the button.
   *
   * **A STEP TEXT SET ON MORE THAN ONE LINE IS AS WIDE AS THE BAR.** At 390px the old bar kept the page's width and
   * squeezed `sum_to(5)`'s line into four lines of a column a few characters wide. The step text may wrap, as
   * `fact(4)`'s must at these widths, but only on a row of its own, where it has the bar's whole width.
   *
   * **THE TITLE SHARES ITS ROW WITH `↺`** — the layout the user chose (2026-10-01), where the title and every control
   * flow as one wrapping line, so the title costs the bar no row of its own.
   */
  it.each(CASES)('in %s at %i px, lies inside the page', async (preset, width, height) => {
    try {
      await at(preset, line, width, height)
      expect(document.documentElement.scrollWidth, 'the page’s scroll width').toBeLessThanOrEqual(innerWidth)
      for (const el of drawn()) {
        const box = el.getBoundingClientRect()
        expect(box.left, `${nameOf(el)}’s left`).toBeGreaterThanOrEqual(0)
        expect(box.right, `${nameOf(el)}’s right`).toBeLessThanOrEqual(innerWidth)
      }
      if (line.long) {
        const box = extend().getBoundingClientRect()
        const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)
        expect(hit, 'what lies at keep recording’s centre').toBe(extend())
      }
      const padding = getComputedStyle(bar())
      const room =
        bar().getBoundingClientRect().width -
        Number.parseFloat(padding.paddingLeft) -
        Number.parseFloat(padding.paddingRight)
      if (linesOf(step()) > 1) {
        expect(step().getBoundingClientRect().width, 'a wrapped step text’s width').toBeGreaterThanOrEqual(room - 0.5)
      }
      expect(Math.abs(centreOf(restart() as Element) - centreOf(title())), '↺ on the title’s row').toBeLessThan(1)
    } finally {
      scrollTo(0, 0)
    }
  })

  /**
   * **AT A DESKTOP'S WIDTH THE BAR IS ONE ROW, WITH THE OLD BAR'S TWO GAPS**: every box on the title's vertical
   * centre, the title at the bar's content edge, `↺` `var(--space-3)` after the title (the old `.step-bar-inner`'s gap),
   * and each box after it `var(--space-2)` after the one before (the old `.controls`' gap).
   *
   * **THAT IS ALL IT HOLDS, NOT WHERE EACH BOX IS.** A change to a box's own width, or to the bar's padding, can
   * leave every case here passing: a padding or a larger font on the title, or a wider padding on the bar, did. Where
   * each box lies against `main` was measured once, by hand, and the roadmap entry has the figures.
   */
  it.each(PRESETS)('in %s at 1280 px, is one row spaced as before', async (preset) => {
    try {
      await at(preset, line, 1280, 800)
      const boxes = drawn()
      expect(boxes[0], 'the title first').toBe(title())
      expect(boxes[1], 'then ↺').toBe(restart())
      for (const el of boxes) {
        expect(Math.abs(centreOf(el) - centreOf(title())), `${nameOf(el)} on the title’s row`).toBeLessThan(1)
      }
      const start = bar().getBoundingClientRect().left + Number.parseFloat(getComputedStyle(bar()).paddingLeft)
      expect(title().getBoundingClientRect().left, 'the title at the bar’s start').toBeCloseTo(start, 1)
      const [first, ...rest] = boxes
      let before = first as HTMLElement
      for (const el of rest) {
        const gap = el.getBoundingClientRect().left - before.getBoundingClientRect().right
        const want = before === title() ? space('--space-3') : space('--space-2')
        expect(Math.abs(gap - want), `the gap before ${nameOf(el)}: ${gap}px, not ${want}px`).toBeLessThanOrEqual(0.5)
        before = el
      }
    } finally {
      scrollTo(0, 0)
    }
  })
})
