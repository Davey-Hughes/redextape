import { beforeAll, describe, expect, it } from 'vitest'
import { PALETTES } from '../../src/palettes'
import { PALETTE_CSS_KEY, PALETTE_KEY, STYLE_KEY } from '../../src/skin'
import { SHELL } from './harness'

const root = document.documentElement
const token = (name: string): string => getComputedStyle(root).getPropertyValue(`--${name}`).trim()
const pair = (id: keyof typeof PALETTES, t: 'bg' | 'accent'): string =>
  `light-dark(${PALETTES[id].light[t]}, ${PALETTES[id].dark[t]})`

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value
  select.dispatchEvent(new Event('change'))
}

describe('the style and palette controls', () => {
  let style: HTMLSelectElement
  let palette: HTMLSelectElement

  // One mount for the file, as every app test does: `main()` runs once per page.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    const s = document.querySelector<HTMLSelectElement>('#style')
    const p = document.querySelector<HTMLSelectElement>('#palette')
    if (s === null || p === null) throw new Error('the header has no style or palette control')
    style = s
    palette = p
  })

  it('mounts as Instrument, matching, with nothing stored', () => {
    expect(root.getAttribute('data-style')).toBe('instrument')
    expect(style.value).toBe('instrument')
    expect(palette.value).toBe('match')
    expect(token('bg')).toBe(pair('instrument', 'bg'))
  })

  it('offers every style and every palette by name', () => {
    expect([...style.options].map((o) => o.textContent)).toEqual(['Paper', 'Terminal', 'Instrument'])
    expect([...palette.options].map((o) => o.textContent)).toEqual(['match style', 'Paper', 'Terminal', 'Instrument'])
  })

  it('switches the style, and a matching palette follows it', () => {
    choose(style, 'paper')
    expect(root.getAttribute('data-style')).toBe('paper')
    expect(token('bg')).toBe(pair('paper', 'bg'))
    expect(localStorage.getItem(STYLE_KEY)).toBe('paper')
  })

  it('switches the palette without changing the style', () => {
    choose(palette, 'terminal')
    expect(root.getAttribute('data-style')).toBe('paper')
    expect(token('accent')).toBe(pair('terminal', 'accent'))
    expect(localStorage.getItem(PALETTE_KEY)).toBe('terminal')
  })

  it('caches what it applied, for the next load’s first paint', () => {
    expect(localStorage.getItem(PALETTE_CSS_KEY)).toContain(`--bg: ${pair('terminal', 'bg')};`)
  })
})
