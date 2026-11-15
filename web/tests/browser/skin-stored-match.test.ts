import { beforeAll, describe, expect, it } from 'vitest'
import { PALETTES } from '../../src/palettes'
import { PALETTE_CSS_KEY, PALETTE_KEY, STYLE_KEY } from '../../src/skin'
import { SHELL } from './harness'

// A STORED `match` IS NO CHOICE, so the page starts in the default palette, not the style's own (tomorrow-palette
// design, its `match style` amendment). Seeded before the one mount, as `skin-restore.test.ts` seeds its choices.
describe('a stored match palette choice', () => {
  beforeAll(async () => {
    localStorage.setItem(STYLE_KEY, 'terminal')
    localStorage.setItem(PALETTE_KEY, 'match')
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
  })

  it('mounts in Material, with the palette control on Material and no match style offered', () => {
    const root = document.documentElement
    const material = `light-dark(${PALETTES.material.light.bg}, ${PALETTES.material.dark.bg})`
    const palette = document.querySelector<HTMLSelectElement>('#palette') as HTMLSelectElement
    expect(root.getAttribute('data-style')).toBe('terminal')
    expect(getComputedStyle(root).getPropertyValue('--bg').trim()).toBe(material)
    expect(palette.value).toBe('material')
    expect([...palette.options].map((o) => o.value)).toEqual([
      'material',
      'paper',
      'terminal',
      'instrument',
      'grayscale',
    ])
    expect(localStorage.getItem(PALETTE_CSS_KEY)).toContain(`--bg: ${material};`)
  })
})
