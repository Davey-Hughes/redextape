import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { chooseStyle, frame, mountAt, rem, toggle, workspaceMenu, workspaceNameText } from './harness'

/**
 * **THE FIFTH TOGGLE KEEPS THE HEADER TO ONE ROW** at 1280 × 800 in every preset, as `style.css`'s column gaps,
 * `.view-toggle` padding and `.bar-spacer` margin are set for: the five toggles share one line, and the header is as
 * tall as with the CLIF toggle taken out. Terminal is held at 1280 px and one pixel over 85rem, either side of its
 * rule.
 *
 * **PAPER IS HELD WHERE IT IS ONE ROW WITHOUT THE TOGGLE.** Instrument draws the header in a face the app ships, so its
 * row is the same on every machine. Paper draws it in the machine's sans-serif, so whether it is one row with the CLIF
 * toggle taken out depends on the machine; read in the same run, if it is, then it is one row with the toggle too.
 */

const PRESETS = ['explorer', 'debugger', 'stage'] as const
const PRESET_NAME = { explorer: 'Explorer ▾', debugger: 'Debugger ▾', stage: 'Stage ▾' } as const
/** `over85rem`: one pixel over 85rem, read once the page is up, where Terminal's full column gap returns. */
const CASES = PRESETS.flatMap((preset) => [
  { preset, style: 'instrument', at: '1280 px' },
  { preset, style: 'terminal', at: '1280 px' },
  { preset, style: 'terminal', at: 'over85rem' },
])

const toggles = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('#views-shown button.view-toggle'),
]
const header = (): HTMLElement => document.querySelector('header.bar') as HTMLElement
const headerHeight = (): number => header().getBoundingClientRect().height
const topOf = (id: string): number => (document.getElementById(id) as HTMLElement).getBoundingClientRect().top
/** One row: `settings`, the header's last control, is where `workspace` is, so nothing has gone to a second row. */
const oneRow = (): boolean => Math.abs(topOf('settings') - topOf('workspace')) <= 1

async function arrange(preset: (typeof PRESETS)[number], style: string, width: number): Promise<void> {
  await page.viewport(width, 800)
  await userEvent.click(document.querySelector('#workspace') as HTMLButtonElement)
  await userEvent.click(workspaceMenu().querySelector(`[data-preset="${preset}"]`) as HTMLButtonElement)
  if (workspaceMenu().matches(':popover-open')) workspaceMenu().hidePopover()
  await chooseStyle(style)
  await frame()
}

function holdsTheFive(preset: (typeof PRESETS)[number], style: string): void {
  expect(workspaceNameText(), 'precondition: the preset').toBe(PRESET_NAME[preset])
  expect(document.documentElement.dataset.style, 'precondition: the style').toBe(style)
  expect(
    toggles().map((b) => b.dataset.shows),
    'precondition: the five',
  ).toEqual(['source', 'lambda', 'tm', 'rxm', 'clif'])
  const first = (toggles()[0] as HTMLButtonElement).getBoundingClientRect().top
  for (const b of toggles())
    expect(Math.abs(b.getBoundingClientRect().top - first), `the ${b.dataset.shows} toggle`).toBeLessThanOrEqual(1)
}

beforeAll(() => mountAt(1280, 800), 30_000)

describe.each(CASES)('the header in $preset, $style, at $at', ({ preset, style, at }) => {
  beforeAll(() => arrange(preset, style, at === 'over85rem' ? 85 * rem() + 1 : 1280), 30_000)

  it('sets the five toggles on one row', () => {
    if (at === 'over85rem')
      expect(Number.parseFloat(getComputedStyle(header()).columnGap), 'precondition: the full gap').toBe(0.8125 * rem())
    holdsTheFive(preset, style)
  })

  it('is as tall as with the CLIF toggle taken out', () => {
    const withClif = headerHeight()
    toggle('clif').style.display = 'none'
    try {
      expect(withClif).toBe(headerHeight())
    } finally {
      toggle('clif').style.display = ''
    }
  })
})

describe.each(PRESETS)('the header in %s, paper, at 1280 px', (preset) => {
  beforeAll(() => arrange(preset, 'paper', 1280), 30_000)

  it('sets the five toggles on one row', () => holdsTheFive(preset, 'paper'))

  it('is one row with the CLIF toggle wherever it is one row with it taken out', () => {
    toggle('clif').style.display = 'none'
    let four: boolean
    try {
      four = oneRow()
    } finally {
      toggle('clif').style.display = ''
    }
    const five = oneRow()
    expect(five || !four, `one row with four toggles: ${four}; with five: ${five}`).toBe(true)
  })
})
