import { beforeAll, describe, expect, it } from 'vitest'
import { PALETTES } from '../../src/palettes'
import { PALETTE_KEY, STYLE_KEY } from '../../src/skin'
import { SHELL } from './harness'

describe('a stored style and palette', () => {
  // Stored BEFORE the one mount this file makes — the state a returning visitor's page starts in.
  beforeAll(async () => {
    localStorage.setItem(STYLE_KEY, 'terminal')
    localStorage.setItem(PALETTE_KEY, 'paper')
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
  })

  it('is what the page mounts in, and what the controls say', () => {
    const root = document.documentElement
    expect(root.getAttribute('data-style')).toBe('terminal')
    expect(getComputedStyle(root).getPropertyValue('--bg').trim()).toBe(
      `light-dark(${PALETTES.paper.light.bg}, ${PALETTES.paper.dark.bg})`,
    )
    expect(document.querySelector<HTMLSelectElement>('#style')?.value).toBe('terminal')
    expect(document.querySelector<HTMLSelectElement>('#palette')?.value).toBe('paper')
  })
})
