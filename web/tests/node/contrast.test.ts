import { describe, expect, it } from 'vitest'
import { contrastRatio, relativeLuminance } from '../../src/contrast'

describe('contrast', () => {
  it('gives the WCAG endpoints', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBe(1)
    expect(contrastRatio('#000000', '#ffffff')).toBe(21)
    expect(contrastRatio('#777777', '#777777')).toBe(1)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#1d4ed8', '#fbfbfa')).toBe(contrastRatio('#fbfbfa', '#1d4ed8'))
  })

  // A value computed independently (the WCAG formula by hand in Python) rather than by this module,
  // so a formula error cannot agree with itself.
  it('matches an independently computed ratio', () => {
    expect(contrastRatio('#645d54', '#f7f4ef')).toBeCloseTo(5.92, 2)
  })

  it('refuses anything but #rrggbb', () => {
    for (const bad of ['#fff', 'fff', '#ffffffff', '#GGGGGG', 'red', '']) {
      expect(() => relativeLuminance(bad)).toThrow(/#rrggbb/)
    }
  })
})
