import { describe, expect, it } from 'vitest'
import {
  binderClashes,
  CONTRAST_FLOORS,
  contrastRatio,
  groundOf,
  RESULT_TINT,
  relativeLuminance,
  tinted,
} from '../../src/contrast'
import { PALETTES } from '../../src/palettes'

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

  // Values worked by hand, per channel `round(0.2 · tint + 0.8 · over)`, rather than by this module.
  it('composites a share of a colour over another as the browser draws it', () => {
    expect(RESULT_TINT).toBe(0.2)
    expect(tinted('#047857', '#fafafa')).toBe('#c9e0d9')
    expect(tinted('#34d399', '#212121')).toBe('#254539')
    expect(tinted('#047857', '#fafafa', 0)).toBe('#fafafa')
    expect(tinted('#047857', '#fafafa', 1)).toBe('#047857')
  })
})

/**
 * The floors and the binder rule, which `palettes.test.ts` holds the built-ins to and an import is checked against
 * (Plan 7 part 6b spec §5.2). Every built-in passes both, so these plant a defect in one and assert it is found: a
 * rule no palette can fail is a rule nothing checks.
 */
describe('the floors and the binder rule', () => {
  it('holds 39 floors, none twice', () => {
    expect(CONTRAST_FLOORS.length).toBe(39)
    expect(new Set(CONTRAST_FLOORS.map(([fg, bg, , tint]) => `${fg} on ${tint ?? ''} over ${bg}`)).size).toBe(39)
  })

  // THE WORD IS READ ON THE MARK, NOT THE PAGE: a green that passes on the page bare fails on its own tint over it.
  it('measures a tinted floor on its ground', () => {
    const v = { ...PALETTES.material.light, result: '#047857', 'result-word': '#047857' }
    const floor = CONTRAST_FLOORS.find(([fg, bg, , tint]) => fg === 'result-word' && bg === 'bg' && tint === 'result')
    expect(floor).toEqual(['result-word', 'bg', 4.5, 'result'])
    expect(v.bg).toBe('#fafafa')
    expect(contrastRatio('#047857', '#fafafa')).toBeGreaterThan(4.5)
    const ratio = floor === undefined ? 0 : contrastRatio(v['result-word'], groundOf(v, floor))
    expect(ratio).toBeLessThan(4.5)
    expect(ratio).toBeCloseTo(3.96, 2)
  })

  it('finds a dim text drawn in the page colour, on every surface it sits on', () => {
    const v = { ...PALETTES.paper.light, 'fg-dim': PALETTES.paper.light.bg }
    const failing = CONTRAST_FLOORS.filter((f) => contrastRatio(v[f[0]], groundOf(v, f)) < f[2])
    expect(failing.map(([fg, bg]) => `${fg} on ${bg}`)).toEqual([
      'fg-dim on bg',
      'fg-dim on bg-raised',
      'fg-dim on bg-chrome',
    ])
  })

  it('names each token a binder drawn in the text colour sits on, and how far apart they are', () => {
    const v = { ...PALETTES.paper.light, 'tok-binder': PALETTES.paper.light['tok-ident'] }
    expect(binderClashes(v)).toEqual([
      { token: 'fg', apart: 0 },
      { token: 'focus-ring', apart: 0 },
      { token: 'tok-ident', apart: 0 },
    ])
  })

  it('refuses a colour that is not #rrggbb, rather than finding it apart from everything', () => {
    expect(() => binderClashes({ ...PALETTES.paper.light, 'tok-binder': '#fff' })).toThrow(/#rrggbb/)
    expect(() => binderClashes({ ...PALETTES.paper.light, fg: 'black' })).toThrow(/#rrggbb/)
  })

  // AN IMPORT GIVES BOTH BASE0B, THE BINDER'S OWN COLOUR, so a rule that held them apart would fail every import.
  it('leaves the result tokens out of the binder rule', () => {
    const binder = PALETTES.paper.light['tok-binder']
    expect(binderClashes({ ...PALETTES.paper.light, result: binder, 'result-word': binder })).toEqual([])
  })

  it('holds a binder 24 away in one channel to be apart, and 23 away to be too close', () => {
    const v = { ...PALETTES.paper.light, 'tok-ident': '#221f1b', fg: '#221f1b', 'focus-ring': '#221f1b' }
    expect(binderClashes({ ...v, 'tok-binder': '#3a1f1b' })).toEqual([])
    expect(binderClashes({ ...v, 'tok-binder': '#391f1b' }).map((c) => c.apart)).toEqual([23, 23, 23])
  })
})
