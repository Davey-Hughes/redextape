import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { STORAGE_KEY } from '../../src/appearance'
import { CUSTOM_PALETTE_KEY, serializeCustomPalette } from '../../src/custom-palette'
import { PALETTES } from '../../src/palettes'
import { PALETTE_CSS_KEY, PALETTE_KEY } from '../../src/skin'
import { NIGHT, storedHalf } from '../node/base16-fixtures'
import { rgb, SHELL } from './harness'

/**
 * **A STORED CUSTOM PALETTE IS THE PAGE'S FROM THE START** (Plan 7 part 6b spec §7.2): what an import leaves in
 * storage — a dark half and the `custom` choice — seeded before `main()` mounts, as `buffer-restore.test.ts` seeds
 * its copies. One mount for the file, for that file's reason.
 */

const body = () => getComputedStyle(document.body)

function choose(id: string, value: string): void {
  const select = document.querySelector<HTMLSelectElement>(id) as HTMLSelectElement
  select.value = value
  select.dispatchEvent(new Event('change'))
}

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
    expect(body().backgroundColor).toBe(rgb(NIGHT[0]))
    expect(body().color).toBe(rgb(NIGHT[5]))
  })

  it('lists custom after the built-in choices, under its half’s name, and chosen', () => {
    const select = document.querySelector<HTMLSelectElement>('#palette') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'match style',
      'Paper',
      'Terminal',
      'Instrument',
      'custom — dark: Night',
    ])
    expect(select.value).toBe('custom')
  })

  it('caches what it applied, for the next load’s first paint', () => {
    expect(localStorage.getItem(PALETTE_CSS_KEY)).toContain(
      `--bg: light-dark(${PALETTES.instrument.light.bg}, ${NIGHT[0]});`,
    )
  })

  it('draws the half not imported in the style’s own palette, and follows a style change', () => {
    choose('#appearance-choice', 'light')
    expect(body().backgroundColor).toBe(rgb(PALETTES.instrument.light.bg))
    choose('#style', 'paper')
    expect(body().backgroundColor).toBe(rgb(PALETTES.paper.light.bg))
    choose('#appearance-choice', 'dark')
    expect(body().backgroundColor).toBe(rgb(NIGHT[0]))
  })

  // AS A USER PICKS IT, from the settings menu: the select's own change is what hands `custom` to the choice.
  it('is picked again from the palette select, after another palette', async () => {
    const select = document.querySelector<HTMLSelectElement>('#palette') as HTMLSelectElement
    await userEvent.click(document.querySelector('#settings') as HTMLElement)
    await userEvent.selectOptions(select, 'terminal')
    expect(body().backgroundColor).toBe(rgb(PALETTES.terminal.dark.bg))
    await userEvent.selectOptions(select, 'custom')
    expect(select.value).toBe('custom')
    expect(localStorage.getItem(PALETTE_KEY)).toBe('custom')
    expect(body().backgroundColor).toBe(rgb(NIGHT[0]))
    await userEvent.click(document.querySelector('#settings') as HTMLElement)
  })
})
