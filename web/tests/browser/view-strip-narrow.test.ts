import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * **EXPLORER'S STEP STRIPS ON A PHONE'S SCREEN** — each view's own step controls (`view-header.ts`'s `.view-steps`,
 * the `steps` switch at `view`), in Explorer, at 320px and 390px, under a short step line and a long one. A strip was
 * one row that never wrapped: at 390px `fact(4)`'s λ strip was 398px wide in a 189px view, so `keep recording` lay at
 * x = 498–599 against the view's right edge at 390 and could be reached only by scrolling the view sideways, and every
 * strip squeezed its step text into a column a few characters wide. What is held is that each strip lies inside its
 * view at a phone's width, with its step text the width of the view's header wherever it wraps and `keep recording` on
 * one line; that at a desktop's width a short line's strip is still one row beside the title with `main`'s gaps,
 * while a long line's strip is two rows, its step text and `keep recording` one line each; and that at every width
 * each control is drawn and no box in the header hides text. (The 398px and 189px are the browser tier's: headless,
 * it draws no scrollbar.) ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const buttonOf = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`) as HTMLButtonElement
const menuOf = (id: string) => document.getElementById(buttonOf(id).getAttribute('aria-controls') ?? '') as HTMLElement
const shown = (el: Element) => el.getClientRects().length > 0

/** Explorer's three views that step, in the order the page draws them. The source view has no strip. */
const STEPPED = ['lambda-0', 'asm-0', 'tm-0'] as const
type Leaf = (typeof STEPPED)[number]

const paneOf = (leaf: Leaf) => document.querySelector<HTMLElement>(`[data-leaf="${leaf}"]`) as HTMLElement
const headerOf = (leaf: Leaf) => paneOf(leaf).querySelector<HTMLElement>('.view-header') as HTMLElement
const headingOf = (leaf: Leaf) => headerOf(leaf).querySelector<HTMLElement>('.view-title-heading') as HTMLElement
const stripOf = (leaf: Leaf) => paneOf(leaf).querySelector<HTMLElement>('.view-steps') as HTMLElement
const controlsOf = (leaf: Leaf) => stripOf(leaf).querySelector<HTMLElement>('.controls') as HTMLElement
const stepOf = (leaf: Leaf) => controlsOf(leaf).querySelector<HTMLElement>('.step') as HTMLElement
const extendOf = (leaf: Leaf) => controlsOf(leaf).querySelector<HTMLButtonElement>('.extend') as HTMLButtonElement
const stepText = (leaf: Leaf) => stepOf(leaf).textContent ?? ''
const SHORT = /^step [\d,]+ of [\d,]+$/

/** Every box a view's strip draws, in the order it draws them: each control, the step text, the continue button. */
const drawn = (leaf: Leaf): HTMLElement[] =>
  [...controlsOf(leaf).querySelectorAll<HTMLElement>('button, select, .step')].filter(shown)
const nameOf = (leaf: Leaf, el: HTMLElement): string =>
  `${leaf}’s ${el === stepOf(leaf) ? 'step text' : (el.getAttribute('aria-label') ?? el.textContent ?? '')}`
const centreOf = (el: Element): number => {
  const box = el.getBoundingClientRect()
  return (box.top + box.bottom) / 2
}
/** The pane's padding box across: where its content may lie without the pane scrolling sideways. */
const innerOf = (pane: HTMLElement): { readonly left: number; readonly right: number } => {
  const left = pane.getBoundingClientRect().left + pane.clientLeft
  return { left, right: left + pane.clientWidth }
}
/**
 * The width a view's header gives a row of its own: its content box. **MEASURED FROM THE HEADER, NOT FROM THE STRIP**:
 * a strip that gave up some of that row (a margin, a narrower box) would measure its own step text against its own
 * narrower width and pass.
 */
const roomOf = (leaf: Leaf): number => {
  const style = getComputedStyle(headerOf(leaf))
  return headerOf(leaf).clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
}
/** A box of a strip by what it reads as: its label, or `the step text`. */
const boxNameOf = (leaf: Leaf, el: HTMLElement): string =>
  el === stepOf(leaf) ? 'the step text' : (el.getAttribute('aria-label') ?? el.textContent ?? '')
/** The boxes a strip draws, by name, in the order it draws them. */
const namesOf = (leaf: Leaf): string[] => drawn(leaf).map((el) => boxNameOf(leaf, el))
/** What a strip draws: the transport, the speed and the step text, and `keep recording` under a long line. */
const boxesFor = (line: Line, leaf: Leaf): string[] => [
  'back to the oldest kept step',
  'one step back',
  'one step forward',
  'play',
  'playback speed',
  'the step text',
  ...(leaf === line.long ? ['keep recording'] : []),
]
/**
 * **NOTHING IN A VIEW'S HEADER HIDES TEXT: NO BOX OVERFLOWS, ACROSS OR DOWN** — the header, the strip, its controls,
 * and each box they draw. Whatever its `overflow`, a box can cut only what runs past it, and that shows as a
 * `scrollWidth` or `scrollHeight` over its `clientWidth` or `clientHeight`; so a step text cut to one line with an
 * ellipsis fails here, as does a strip or its controls clipping a row, where every box's position can still pass.
 *
 * **THE SPEED SELECT IS LEFT OUT.** Chrome draws a select's chosen option itself, and its `scrollHeight` read 20
 * against a `clientHeight` of 18 in every case this file measures (2026-10-04), where no other box here read over.
 */
const hidesNothing = (leaf: Leaf): void => {
  const holders: [string, HTMLElement][] = [
    [`${leaf}’s header`, headerOf(leaf)],
    [`${leaf}’s strip`, stripOf(leaf)],
    [`${leaf}’s controls box`, controlsOf(leaf)],
    ...drawn(leaf)
      .filter((el) => el.tagName !== 'SELECT')
      .map((el): [string, HTMLElement] => [nameOf(leaf, el), el]),
  ]
  for (const [name, el] of holders) {
    expect.soft(el.scrollWidth, `${name}’s scroll width`).toBeLessThanOrEqual(el.clientWidth)
    expect.soft(el.scrollHeight, `${name}’s scroll height`).toBeLessThanOrEqual(el.clientHeight)
  }
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
type Row = { centre: number; top: number; bottom: number; readonly boxes: HTMLElement[] }
/**
 * The rows a strip's boxes are set on, top to bottom, each from its first box's top to its last box's bottom, with
 * its boxes in the order it draws them. The strip centres every box on its row, so the boxes of one row share a
 * centre, and the row's tallest box spans it.
 */
const rowsOf = (leaf: Leaf): Row[] => {
  const rows: Row[] = []
  for (const el of drawn(leaf)) {
    const box = el.getBoundingClientRect()
    const row = rows.find((r) => Math.abs(r.centre - centreOf(el)) < 1)
    if (row === undefined) rows.push({ centre: centreOf(el), top: box.top, bottom: box.bottom, boxes: [el] })
    else {
      row.top = Math.min(row.top, box.top)
      row.bottom = Math.max(row.bottom, box.bottom)
      row.boxes.push(el)
    }
  }
  return rows.sort((a, b) => a.top - b.top)
}
/** Each gap between one row of a strip and the next, in pixels. */
const rowGapsOf = (leaf: Leaf): number[] =>
  rowsOf(leaf).flatMap((row, i, rows) => (i === 0 ? [] : [row.top - (rows[i - 1] as Row).bottom]))
/** What each row of a strip holds, by each box's name (`boxNameOf`). */
const rowNamesOf = (leaf: Leaf): string[][] => rowsOf(leaf).map((row) => row.boxes.map((el) => boxNameOf(leaf, el)))

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

type Line = {
  readonly example: string
  readonly name: string
  /** The view whose line is long, or `null` when every view's line is short. */
  readonly long: Leaf | null
  holds(): void
}

/**
 * **THE TWO LINES.** `sum_to(5)` ends in every leg, so each view's line is the step count alone and no view has a
 * continue button. `fact(4)` fills the λ leg's history, so the λ view's line names that and its oldest kept step and
 * its strip carries `keep recording`; the asm and TM legs end, so their lines are short.
 */
const LINES: readonly Line[] = [
  {
    example: 'sum-to',
    name: 'sum_to(5)’s short lines',
    long: null,
    holds: () => {
      for (const leaf of STEPPED) {
        expect(stepText(leaf), `precondition: ${leaf}’s short line`).toMatch(SHORT)
        expect(shown(extendOf(leaf)), `precondition: no continue button in ${leaf}`).toBe(false)
      }
    },
  },
  {
    example: 'fact',
    name: 'fact(4)’s long λ line',
    long: 'lambda-0',
    holds: () => {
      expect(stepText('lambda-0'), 'precondition: the λ view’s long line').toContain('history is full')
      expect(extendOf('lambda-0').textContent, 'precondition: the λ view’s continue button').toBe('keep recording')
      expect(shown(extendOf('lambda-0')), 'precondition: the continue button is drawn').toBe(true)
      for (const leaf of ['asm-0', 'tm-0'] as const) {
        expect(stepText(leaf), `precondition: ${leaf}’s short line`).toMatch(SHORT)
        expect(shown(extendOf(leaf)), `precondition: no continue button in ${leaf}`).toBe(false)
      }
    },
  },
]

/**
 * Put the page at `width` by `height` in Explorer, and **ASSERT THE STATE THE CASE MEANS TO MEASURE** before it
 * measures anything: the preset, the three views that step each drawing its strip, no view scrolled sideways, and the
 * line under test. A probe that skipped this would report whatever the previous case left behind.
 */
async function at(line: Line, width: number, height: number): Promise<void> {
  presetOf('explorer')
  await page.viewport(width, height)
  expect(innerWidth, 'precondition: the page’s width').toBe(width)
  expect(buttonOf('workspace').textContent, 'precondition: the preset').toMatch(/^explorer/i)
  expect(
    [...document.querySelectorAll<HTMLElement>('[data-leaf]')]
      .filter((pane) => pane.querySelector('.view-steps .controls') !== null)
      .map((pane) => pane.dataset.leaf),
    'precondition: the views that draw a strip',
  ).toEqual([...STEPPED])
  for (const leaf of STEPPED) {
    expect(shown(controlsOf(leaf)), `precondition: ${leaf}’s strip is drawn`).toBe(true)
    // A SIDEWAYS SCROLL WOULD BRING A CONTROL PAST THE VIEW'S EDGE BACK INTO VIEW, which is the defect this file holds.
    expect(paneOf(leaf).scrollLeft, `precondition: ${leaf} is not scrolled sideways`).toBe(0)
  }
  line.holds()
}

const PHONES = [
  [320, 568],
  [390, 844],
] as const

describe.each(LINES)('Explorer’s step strips, under $name', (line) => {
  /**
   * Pick the line's example, and wait for its line in the λ view and then for the run's result, so nothing on the
   * page moves while it is measured.
   *
   * **TWO WAITS, NOT ONE**, each with its own name and its own 10s, and the two together inside the hook's own 30s.
   * `fact(4)`'s λ line is final well before the other legs' result arrives. Here, under a 25% CPU quota, three runs on
   * 2026-10-04 put the two together at 5,413, 6,117 and 7,001ms, the last 70% of one wait's 10s; the split is
   * `step-bar-narrow.test.ts`', where #123 measured the same pair, under `unary` in Debugger, past it.
   */
  beforeAll(async () => {
    await page.viewport(1280, 800)
    presetOf('explorer')
    const before = stepText('lambda-0')
    await userEvent.click(buttonOf('examples'))
    await userEvent.click(menuOf('examples').querySelector(`button[data-example="${line.example}"]`) as HTMLElement)
    // THE LINE BEFORE THE PICK IS EXCLUDED BY NAME: the program it replaced also ends, in a line the short one's
    // pattern matches.
    await until(
      () =>
        stepText('lambda-0') !== before &&
        (line.long === null ? SHORT.test(stepText('lambda-0')) : stepText('lambda-0').includes('history is full')),
      `${line.name} in the λ view`,
    )
    await until(idle, `${line.name}’s run to its result`)
  })

  /**
   * **NO STRIP RUNS PAST ITS VIEW, AND EVERY BOX IT DRAWS IS INSIDE THE VIEW.** The header first, since a header
   * wider than its view is what made the view scroll; then the strip, then each of its boxes, against the view's
   * padding box (`left + clientWidth`), since a view scrolls rather than widening the page. `keep recording` is held
   * to be CLICKABLE without a sideways scroll: `elementFromPoint` at its centre is the button, once the view and the
   * page are scrolled VERTICALLY to it if it lies below either's fold.
   *
   * **A STEP TEXT SET ON MORE THAN ONE LINE IS AS WIDE AS ITS VIEW'S HEADER.** At 390px the old strip squeezed
   * `sum_to(5)`'s line into four lines of a 28px column. The step text may wrap, and `fact(4)`'s λ line must at these
   * widths, so it is held to more than one line; but only on a row of its own, where it has the header's whole width
   * (`roomOf`, which says why the strip's own width will not do). **`keep recording` IS ONE LINE**, 146px wide in a
   * 154px or 189px view. **THE ROWS OF A WRAPPED STRIP ARE `var(--space-1)` APART**, the step bar's own row gap
   * (`.step-bar-inner`), where `.controls`' own `gap` would set them `var(--space-2)` apart. **EVERY CONTROL IS DRAWN
   * AND NONE HIDES TEXT** (`boxesFor`, `hidesNothing`).
   *
   * **EVERY GEOMETRY ASSERTION IS SOFT, EVERY PRECONDITION HARD**, here and at 1280px: a red run names each property
   * that fails rather than stopping at the first, so the header, each box and `keep recording` are each shown able to
   * fail, while a case whose state is not the one it means to measure stops before it measures anything.
   */
  it.each(PHONES)('at %i px, every strip lies inside its view', async (width, height) => {
    try {
      await at(line, width, height)
      expect.soft(document.documentElement.scrollWidth, 'the page’s scroll width').toBeLessThanOrEqual(innerWidth)
      for (const leaf of STEPPED) {
        expect.soft(namesOf(leaf), `${leaf}’s boxes`).toEqual(boxesFor(line, leaf))
        hidesNothing(leaf)
        const inner = innerOf(paneOf(leaf))
        const strip = stripOf(leaf).getBoundingClientRect()
        expect.soft(strip.left, `${leaf}’s strip’s left`).toBeGreaterThanOrEqual(inner.left)
        expect.soft(strip.right, `${leaf}’s strip’s right`).toBeLessThanOrEqual(inner.right)
        for (const el of drawn(leaf)) {
          const box = el.getBoundingClientRect()
          expect.soft(box.left, `${nameOf(leaf, el)}’s left`).toBeGreaterThanOrEqual(inner.left)
          expect.soft(box.right, `${nameOf(leaf, el)}’s right`).toBeLessThanOrEqual(inner.right)
        }
        if (linesOf(stepOf(leaf)) > 1) {
          expect
            .soft(stepOf(leaf).getBoundingClientRect().width, `${leaf}’s wrapped step text’s width`)
            .toBeGreaterThanOrEqual(roomOf(leaf) - 0.5)
        }
        for (const gap of rowGapsOf(leaf)) {
          expect
            .soft(Math.abs(gap - space('--space-1')), `${leaf}: a gap between rows, ${gap}px`)
            .toBeLessThanOrEqual(0.5)
        }
      }
      if (line.long !== null) {
        const pane = paneOf(line.long)
        const extend = extendOf(line.long)
        expect.soft(linesOf(stepOf(line.long)), `${line.long}’s long step text’s lines`).toBeGreaterThan(1)
        expect.soft(linesOf(extend), 'keep recording’s lines').toBe(1)
        // VERTICALLY ONLY, the view and then the page: `elementFromPoint` sees only what is in the viewport.
        const below = extend.getBoundingClientRect().bottom - (pane.getBoundingClientRect().top + pane.clientTop)
        if (below > pane.clientHeight) pane.scrollTop += below - pane.clientHeight
        if (extend.getBoundingClientRect().bottom > innerHeight)
          scrollTo(0, scrollY + extend.getBoundingClientRect().bottom - innerHeight)
        expect(pane.scrollLeft, 'precondition: the view is not scrolled sideways').toBe(0)
        expect(scrollX, 'precondition: the page is not scrolled sideways').toBe(0)
        const box = extend.getBoundingClientRect()
        const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)
        expect.soft(hit, 'what lies at keep recording’s centre').toBe(extend)
      }
    } finally {
      for (const leaf of STEPPED) paneOf(leaf).scrollTop = 0
      scrollTo(0, 0)
    }
  })

  /**
   * **AT A DESKTOP'S WIDTH A SHORT LINE'S STRIP IS ONE ROW BESIDE THE TITLE, WITH `main`'S GAPS**: every box of the
   * header (the title, each control, the step text, the view's actions) on the title's vertical centre, `↺`
   * `var(--space-3)` after the heading (the header's own gap), and each box of the strip after it `var(--space-2)`
   * after the one before (`.controls`' gap). **A LONG LINE'S STRIP IS TWO ROWS, THE TRANSPORT AND THE SPEED, THEN THE
   * STEP TEXT AND `keep recording`, EACH OF THESE ON ONE LINE.** At 1280px the old strip already took a row of its own
   * under the title, and kept every box on that one row by setting `fact(4)`'s λ line and its button on two lines
   * each. The rows are `var(--space-1)` apart, as at a phone's width. Held by what each row holds, since a strip of
   * three rows (`keep recording` on one of its own) keeps every line to one and every box inside the view. Every
   * control is drawn and none hides text, as at a phone's width.
   *
   * **THAT IS ALL IT HOLDS, NOT WHERE EACH BOX IS.** A box that grows inside its row's room moves every box after it
   * and keeps every gap, so it leaves every case here passing: a speed select padded `0.1em 0.6em` moved the asm view's
   * step text 7.19px and did. Grown past that room, the view's actions take a second row, which this case catches.
   * Where each box lies against `main` was measured once, by hand, and the roadmap entry has the figures.
   */
  it('at 1280 px, a short line is one row as before and a long line is two rows of one line', async () => {
    await at(line, 1280, 800)
    for (const leaf of STEPPED) {
      expect.soft(namesOf(leaf), `${leaf}’s boxes`).toEqual(boxesFor(line, leaf))
      hidesNothing(leaf)
      if (leaf === line.long) {
        expect.soft(rowNamesOf(leaf), `${leaf}’s rows`).toEqual([
          ['back to the oldest kept step', 'one step back', 'one step forward', 'play', 'playback speed'],
          ['the step text', 'keep recording'],
        ])
        expect.soft(linesOf(stepOf(leaf)), `${leaf}’s long step text’s lines`).toBe(1)
        expect.soft(linesOf(extendOf(leaf)), 'keep recording’s lines').toBe(1)
        for (const gap of rowGapsOf(leaf)) {
          expect
            .soft(Math.abs(gap - space('--space-1')), `${leaf}: a gap between rows, ${gap}px`)
            .toBeLessThanOrEqual(0.5)
        }
        const inner = innerOf(paneOf(leaf))
        expect
          .soft(stripOf(leaf).getBoundingClientRect().right, `${leaf}’s strip’s right`)
          .toBeLessThanOrEqual(inner.right)
        continue
      }
      const title = headingOf(leaf)
      const header = [...headerOf(leaf).querySelectorAll<HTMLElement>('.view-title, button, select, .step')].filter(
        shown,
      )
      for (const el of header) {
        expect.soft(Math.abs(centreOf(el) - centreOf(title)), `${nameOf(leaf, el)} on the title’s row`).toBeLessThan(1)
      }
      const [first, ...rest] = drawn(leaf)
      expect(first?.getAttribute('aria-label'), `precondition: ${leaf}’s strip starts at ↺`).toBe(
        'back to the oldest kept step',
      )
      const lead = (first as HTMLElement).getBoundingClientRect().left - title.getBoundingClientRect().right
      expect.soft(Math.abs(lead - space('--space-3')), `${leaf}: the gap before ↺, ${lead}px`).toBeLessThanOrEqual(0.5)
      let before = first as HTMLElement
      for (const el of rest) {
        const gap = el.getBoundingClientRect().left - before.getBoundingClientRect().right
        expect
          .soft(Math.abs(gap - space('--space-2')), `the gap before ${nameOf(leaf, el)}, ${gap}px`)
          .toBeLessThanOrEqual(0.5)
        before = el
      }
    }
  })
})
