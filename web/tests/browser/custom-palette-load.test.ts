import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { STORAGE_KEY } from '../../src/appearance'
import { CUSTOM_PALETTE_KEY, serializeCustomPalette } from '../../src/custom-palette'
import { PALETTES } from '../../src/palettes'
import { PALETTE_CSS_KEY, PALETTE_KEY, STYLE_IDS } from '../../src/skin'
import { NIGHT, storedHalf } from '../node/base16-fixtures'
import { bodyStyle, chooseOption, rgb, SHELL } from './harness'

/**
 * **A STORED CUSTOM PALETTE IS THE PAGE'S FROM THE START** (Plan 7 part 6b spec §7.2): what an import leaves in
 * storage — a dark half and the `custom` choice — seeded before `main()` mounts, as `buffer-restore.test.ts` seeds
 * its copies. One mount for the file, for that file's reason.
 */

beforeAll(async () => {
  localStorage.setItem(CUSTOM_PALETTE_KEY, serializeCustomPalette({ dark: storedHalf('Night', NIGHT) }))
  localStorage.setItem(PALETTE_KEY, 'custom')
  localStorage.setItem(STORAGE_KEY, 'dark')
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
})

describe('a stored custom palette, at start-up', () => {
  it('draws the page in the stored half', () => {
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(bodyStyle().backgroundColor).toBe(rgb(NIGHT[0]))
    expect(bodyStyle().color).toBe(rgb(NIGHT[5]))
  })

  it('lists custom after the built-in choices, under its half’s name, and chosen', () => {
    const select = document.querySelector<HTMLSelectElement>('#palette') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Material',
      'Paper',
      'Terminal',
      'Instrument',
      'Grayscale',
      'custom — dark: Night',
    ])
    expect(select.value).toBe('custom')
  })

  it('caches what it applied, for the next load’s first paint', () => {
    expect(localStorage.getItem(PALETTE_CSS_KEY)).toContain(
      `--bg: light-dark(${PALETTES.material.light.bg}, ${NIGHT[0]});`,
    )
  })

  // THE HALF NOT IMPORTED IS THE DEFAULT PALETTE'S, WHATEVER THE STYLE (tomorrow-palette design, its `match style`
  // amendment): every style is tried, so a fallback to the style's own palette would show under each.
  it('draws the half not imported in Material, and keeps it through every style change', () => {
    chooseOption('#appearance-choice', 'light')
    expect(bodyStyle().backgroundColor).toBe(rgb(PALETTES.material.light.bg))
    for (const style of STYLE_IDS) {
      chooseOption('#style', style)
      expect(document.documentElement.getAttribute('data-style')).toBe(style)
      expect(bodyStyle().backgroundColor).toBe(rgb(PALETTES.material.light.bg))
    }
    chooseOption('#style', 'paper')
    chooseOption('#appearance-choice', 'dark')
    expect(bodyStyle().backgroundColor).toBe(rgb(NIGHT[0]))
  })

  // AS A USER PICKS IT, from the settings menu: the select's own change is what hands `custom` to the choice.
  it('is picked again from the palette select, after another palette', async () => {
    const select = document.querySelector<HTMLSelectElement>('#palette') as HTMLSelectElement
    await userEvent.click(document.querySelector('#settings') as HTMLElement)
    await userEvent.selectOptions(select, 'terminal')
    expect(bodyStyle().backgroundColor).toBe(rgb(PALETTES.terminal.dark.bg))
    await userEvent.selectOptions(select, 'custom')
    expect(select.value).toBe('custom')
    expect(localStorage.getItem(PALETTE_KEY)).toBe('custom')
    expect(bodyStyle().backgroundColor).toBe(rgb(NIGHT[0]))
    await userEvent.click(document.querySelector('#settings') as HTMLElement)
  })
})
