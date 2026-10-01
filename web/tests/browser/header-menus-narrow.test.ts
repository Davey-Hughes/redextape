import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * **THE HEADER'S WIDE MENUS ON A PHONE'S SCREEN** — Plan 7 part 6a spec §4.2, §5.2 and §8's phone-width row, for
 * `examples ▾` and the workspace menu, the two whose minimum width is `20rem`, and `share`'s popover, whose width is
 * `32rem` at a desktop's. Each is no wider than the page less a
 * `1rem` gutter each side at a phone's width, and its button sits in a header that wraps, so what is held is where the
 * open menu lies, measured: inside that gutter on both sides of the page. The page under it is held not to scroll
 * sideways too. The desktop cases hold the geometry the phone's must not change. ONE MOUNT FOR THE FILE,
 * for the reason every sibling gives.
 */

const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const rem = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
const buttonOf = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`) as HTMLButtonElement
const menuOf = (id: string) => document.getElementById(buttonOf(id).getAttribute('aria-controls') ?? '') as HTMLElement

beforeAll(async () => {
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(idle, 'the first compile')
})

/** Put the workspace on `preset`, by the menu's own buttons. */
const presetOf = (preset: string): void => {
  buttonOf('workspace').click()
  menuOf('workspace').querySelector<HTMLButtonElement>(`[data-preset="${preset}"]`)?.click()
  if (menuOf('workspace').matches(':popover-open')) menuOf('workspace').hidePopover()
}

/** Open `id`'s menu with a click on a page `width` by `height`, and answer where it lies. */
async function openAt(id: string, width: number, height: number): Promise<DOMRect> {
  await page.viewport(width, height)
  await userEvent.click(buttonOf(id))
  expect(menuOf(id).matches(':popover-open')).toBe(true)
  return menuOf(id).getBoundingClientRect()
}

/**
 * Hold a menu's `rect` to a phone-width page: inside its gutter on both sides, on a page with no sideways scroll.
 *
 * **BOTH SIDES, NOT ONLY THE WIDTH.** A menu no wider than the gutter allows can still sit flush with the page's edge,
 * where the browser shifts an anchored menu that would run past it: the examples and workspace menus did, at 320, 360
 * and 390px, until each was given a `1rem` margin on its end side.
 */
function expectWithinGutter(rect: DOMRect, width: number): void {
  expect(innerWidth).toBe(width)
  // THE PAGE'S OWN WIDTH, WHICH THE HEADER'S WRAP KEEPS, AND IN DEBUGGER AND STAGE THE STEP BAR'S: `scrollWidth` cannot
  // see the menu, which is in the top layer. Measured: the workspace menu, 370.5px wide on a 320px page, left it at 320.
  // The rect below is what holds the menu.
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  expect(rect.left, 'the gutter on the left').toBeGreaterThanOrEqual(rem())
  expect(rect.right, 'the gutter on the right').toBeLessThanOrEqual(innerWidth - rem())
  expect(rect.width).toBeLessThanOrEqual(innerWidth - 2 * rem())
}

/** The phones' widths, and 480px, where each menu's maximum is what binds (the per-menu docs have the figures). */
const WIDTHS = [
  [320, 568],
  [360, 640],
  [390, 844],
  [480, 800],
] as const

describe('examples ▾, open', () => {
  /**
   * At 480px the maximum is what binds: without it the menu is 464px wide there, past the 448px the gutter leaves. At
   * the three phones' widths the minimum decides.
   */
  it.each(WIDTHS)(
    'lies inside its gutter on a page %i px wide, on a page that does not scroll sideways',
    async (width, height) => {
      try {
        expectWithinGutter(await openAt('examples', width, height), width)
      } finally {
        menuOf('examples').hidePopover()
      }
    },
  )

  it('lies under its button at a desktop width, 20rem to 36rem wide', async () => {
    try {
      const rect = await openAt('examples', 1280, 800)
      const anchor = buttonOf('examples').getBoundingClientRect()
      expect(rect.left).toBeCloseTo(anchor.left, 1)
      expect(rect.top).toBeCloseTo(anchor.bottom, 1)
      expect(rect.width).toBeGreaterThanOrEqual(20 * rem())
      expect(rect.width).toBeLessThanOrEqual(36 * rem())
    } finally {
      menuOf('examples').hidePopover()
    }
  })
})

describe('share, open', () => {
  /**
   * **ITS BUTTON SITS NEAR THE HEADER'S RIGHT EDGE, SO THE POPOVER MEETS THAT EDGE.** Without its end margin it lay
   * flush with it at 480px, and at 390px in Debugger (`style.css`'s gutter block has the figures). **IN EACH PRESET**,
   * since a preset changes the header's rows and with them where the button sits. **THE PAGE DOES NOT SCROLL SIDEWAYS
   * IN ANY OF THEM.** At 320px in Debugger and Stage it did, 36px wider than the page with every menu shut, until the
   * step bar wrapped (`step-bar-narrow.test.ts` holds the bar); these cases held then only that the popover did not
   * widen it further.
   */
  describe.each(['explorer', 'debugger', 'stage'])('in %s', (preset) => {
    it.each(WIDTHS)(
      'lies inside its gutter on a page %i px wide, on a page that does not scroll sideways',
      async (width, height) => {
        try {
          presetOf(preset)
          expectWithinGutter(await openAt('share', width, height), width)
        } finally {
          menuOf('share').hidePopover()
          presetOf('explorer')
        }
      },
    )
  })

  it('opens leftward under its button at a desktop width, 32rem wide', async () => {
    try {
      const rect = await openAt('share', 1280, 800)
      const anchor = buttonOf('share').getBoundingClientRect()
      expect(rect.right).toBeCloseTo(anchor.right, 1)
      expect(rect.top).toBeCloseTo(anchor.bottom, 1)
      expect(rect.width).toBeCloseTo(32 * rem(), 1)
    } finally {
      menuOf('share').hidePopover()
    }
  })
})

describe('the workspace menu, open', () => {
  /** Every control in the menu, and the rows that hold the switches' values. */
  const controls = () => [...menuOf('workspace').querySelectorAll<HTMLButtonElement>('button')]
  const rows = () => [...menuOf('workspace').querySelectorAll<HTMLElement>('.menu-group')]

  /**
   * **A ROW'S VALUES WRAP UNDER ITS LABEL RATHER THAN RUN PAST THE MENU'S EDGE.** Its rows are 360.5px wide on one
   * line, so without the wrap the menu overflowed a 320px and a 360px page; with a maximum but no wrap, the menu would
   * fit and its values would not. Both are held: the menu's rect, and every control inside it.
   */
  it.each(WIDTHS)(
    'lies inside its gutter on a page %i px wide, with every control inside it',
    async (width, height) => {
      try {
        const rect = await openAt('workspace', width, height)
        expectWithinGutter(rect, width)
        for (const control of controls()) {
          const box = control.getBoundingClientRect()
          const name = control.textContent?.trim()
          expect(box.left, `${name}'s left`).toBeGreaterThanOrEqual(rect.left)
          expect(box.right, `${name}'s right`).toBeLessThanOrEqual(rect.right)
        }
      } finally {
        menuOf('workspace').hidePopover()
      }
    },
  )

  /**
   * **WHERE THE MENU IS NOT ANCHORED, THE MAXIMUM IS WHAT KEEPS THE GUTTER.** Anchored, the menu's content is fitted
   * to the room from its button, at 115px, to the page's right edge, which is always narrower than the gutter allows.
   * Where that room is narrower than the minimum, the minimum decides and the browser shifts the menu left to keep it
   * on the page: at 320px it is 288px wide against a 205px room. Either way the maximum never binds above. A browser
   * without `position-area` takes `style.css`'s `@supports not (position-area: block-end)` branch and centres the menu
   * on the page instead, where it would span the page. That layout is put on for these cases, on the rule the branch
   * overrides: no anchored area, no fallbacks, and the branch's `margin: auto`; and on the menus' own ids, whose end
   * margin sits in the `@supports (position-area: block-end)` block such a browser does not apply either, and would
   * otherwise beat a class rule. Put on by hand, it holds the layout the branch gives, not that the branch applies.
   */
  it.each(WIDTHS.slice(0, 3))(
    'lies within its gutter on a page %i px wide where it is not anchored',
    async (width, height) => {
      const unanchored = document.createElement('style')
      unanchored.textContent =
        '.header-menu { position-area: none; position-try-fallbacks: none; margin: auto; } ' +
        '#examples-menu, #workspace-menu { margin: auto; }'
      document.head.append(unanchored)
      try {
        expectWithinGutter(await openAt('workspace', width, height), width)
      } finally {
        menuOf('workspace').hidePopover()
        unanchored.remove()
      }
    },
  )

  it('lies under its button at a desktop width, each row on one line', async () => {
    try {
      const rect = await openAt('workspace', 1280, 800)
      const anchor = buttonOf('workspace').getBoundingClientRect()
      expect(rect.left).toBeCloseTo(anchor.left, 1)
      expect(rect.top).toBeCloseTo(anchor.bottom, 1)
      expect(rect.width).toBeGreaterThanOrEqual(20 * rem())
      expect(rows().length).toBeGreaterThan(0)
      for (const row of rows()) {
        const tops = [...row.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top))
        expect(new Set(tops).size, `${row.getAttribute('aria-label')}'s values on one line`).toBe(1)
      }
    } finally {
      menuOf('workspace').hidePopover()
    }
  })
})

/**
 * **`examples ▾` DOES NOT COST A PHONE'S PAGE A HEADER ROW** — at 390px, in Explorer and Debugger, it pushed the
 * header from three rows to four: 136px to 181px, taken from the views. **NOR DOES `share`, BEFORE `appearance`**
 * (Plan 7 part 6a spec §5.2): after `examples ▾` it took Debugger to four rows here. Rows are counted rather than the height
 * measured, one per distinct vertical centre, since the header's `align-items: center` puts every control in a row on
 * one. Held in Instrument, the page's default style, whose faces are bundled; Paper and Terminal draw the header in
 * the machine's own fonts, so their rows depend on the machine, and are measured by hand rather than held here.
 */
describe('the header at 390px', () => {
  const headerRows = (): number => {
    const centres: number[] = []
    for (const control of document.querySelector('header.bar')?.children ?? []) {
      const box = control.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      const centre = (box.top + box.bottom) / 2
      if (!centres.some((c) => Math.abs(c - centre) < 2)) centres.push(centre)
    }
    return centres.length
  }

  it.each(['explorer', 'debugger', 'stage'])(
    'keeps to three rows in %s, examples ▾ and share among them',
    async (preset) => {
      await page.viewport(390, 844)
      try {
        presetOf(preset)
        expect(document.documentElement.getAttribute('data-style') ?? 'instrument').toBe('instrument')
        expect(buttonOf('examples').getBoundingClientRect().width).toBeGreaterThan(0)
        expect(buttonOf('share').getBoundingClientRect().width).toBeGreaterThan(0)
        expect(headerRows()).toBe(3)
      } finally {
        presetOf('explorer')
      }
    },
  )
})
