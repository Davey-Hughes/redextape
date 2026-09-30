import { describe, expect, it } from 'vitest'
import { COLOUR_TOKENS, PALETTE_CSS_PATTERN, PALETTES, paletteDeclarations } from '../../src/palettes'
import {
  applySkin,
  customPaletteLabel,
  DEFAULT_STYLE,
  PALETTE_CHOICE_LABELS,
  PALETTE_CHOICES,
  readPaletteChoice,
  readStyle,
  resolvePalette,
  type SkinRoot,
  STYLE_IDS,
  STYLE_LABELS,
} from '../../src/skin'
import { DAY, NIGHT, storedHalf } from './base16-fixtures'

function fakeRoot(): SkinRoot & { attrs: Map<string, string>; props: Map<string, string> } {
  const attrs = new Map<string, string>()
  const props = new Map<string, string>()
  return {
    attrs,
    props,
    setAttribute: (k, v) => {
      attrs.set(k, v)
    },
    style: {
      setProperty: (k, v) => {
        props.set(k, v)
      },
    },
  }
}

describe('skin', () => {
  it('defaults to Instrument', () => {
    expect(DEFAULT_STYLE).toBe('instrument')
    expect(readStyle(null)).toBe('instrument')
  })

  it('reads a stored style, and anything else as the default', () => {
    for (const s of STYLE_IDS) expect(readStyle(s)).toBe(s)
    for (const bad of ['', 'Paper', 'match', 'dark', 'instrument ']) expect(readStyle(bad)).toBe('instrument')
  })

  it('reads a stored palette choice, and anything else as match', () => {
    for (const c of PALETTE_CHOICES) expect(readPaletteChoice(c, null)).toBe(c)
    for (const bad of [null, '', 'Paper', 'system', 'Custom']) expect(readPaletteChoice(bad, null)).toBe('match')
  })

  it('resolves match to the style’s own palette, and a named palette to itself', () => {
    expect(resolvePalette('paper', 'match', null)).toBe(PALETTES.paper)
    expect(resolvePalette('paper', 'terminal', null)).toBe(PALETTES.terminal)
  })

  it('labels every style and every choice', () => {
    for (const s of STYLE_IDS) expect(STYLE_LABELS[s]).not.toBe('')
    for (const c of PALETTE_CHOICES) expect(PALETTE_CHOICE_LABELS[c]).not.toBe('')
  })

  it('writes the style attribute and every token', () => {
    const root = fakeRoot()
    applySkin(root, 'paper', 'terminal', null)
    expect(root.attrs.get('data-style')).toBe('paper')
    for (const t of COLOUR_TOKENS) {
      expect(root.props.get(`--${t}`)).toBe(`light-dark(${PALETTES.terminal.light[t]}, ${PALETTES.terminal.dark[t]})`)
    }
  })

  // WHAT `main.ts` CACHES: the declarations of the palette a choice resolves to, in the one form the pre-paint
  // script admits.
  it('caches a choice as its resolved palette’s declarations', () => {
    const cached = paletteDeclarations(resolvePalette('paper', 'terminal', null))
    expect(cached).toMatch(PALETTE_CSS_PATTERN)
    expect(cached).toContain(`--bg: light-dark(${PALETTES.terminal.light.bg}, ${PALETTES.terminal.dark.bg});`)
  })
})

/** The imported palette as a choice (Plan 7 part 6b spec §7.2). */
describe('skin — custom', () => {
  const night = storedHalf('Night', NIGHT)
  const day = { ...storedHalf('Day', DAY), adjusted: true }

  it('reads custom only while a half is stored, and match otherwise', () => {
    expect(readPaletteChoice('custom', { dark: night })).toBe('custom')
    expect(readPaletteChoice('custom', null)).toBe('match')
  })

  it('writes each stored half over the style’s own variant, and keeps the style’s own for a half not stored', () => {
    const p = resolvePalette('terminal', 'custom', { dark: night })
    expect(p.id).toBe('custom')
    expect(p.dark).toEqual(night.tokens)
    expect(p.light).toEqual(PALETTES.terminal.light)
    // A STYLE CHANGE MOVES THE HALF THAT FALLS BACK, and only that half.
    const q = resolvePalette('paper', 'custom', { dark: night })
    expect(q.dark).toEqual(night.tokens)
    expect(q.light).toEqual(PALETTES.paper.light)
  })

  it('falls back token by token where a stored half lacks one', () => {
    const { fg: _, ...lacking } = night.tokens
    const p = resolvePalette('instrument', 'custom', { dark: { ...night, tokens: lacking } })
    expect(p.dark.fg).toBe(PALETTES.instrument.dark.fg)
    expect(p.dark.bg).toBe(NIGHT[0])
  })

  it('draws the style’s own palette for custom with nothing stored', () => {
    const p = resolvePalette('paper', 'custom', null)
    expect([p.light, p.dark]).toEqual([PALETTES.paper.light, PALETTES.paper.dark])
  })

  it('applies a custom palette, and caches it as its resolved declarations', () => {
    const root = fakeRoot()
    applySkin(root, 'instrument', 'custom', { light: day, dark: night })
    expect(root.props.get('--bg')).toBe(`light-dark(${DAY[0]}, ${NIGHT[0]})`)
    const cached = paletteDeclarations(resolvePalette('instrument', 'custom', { light: day, dark: night }))
    expect(cached).toMatch(PALETTE_CSS_PATTERN)
    expect(cached).toContain(`--bg: light-dark(${DAY[0]}, ${NIGHT[0]});`)
  })

  it('names each half in the select, and says which were adjusted', () => {
    expect(customPaletteLabel({ light: day, dark: night })).toBe('custom — light: Day (adjusted) · dark: Night')
    expect(customPaletteLabel({ dark: { ...night, name: '' } })).toBe('custom — dark: untitled')
  })
})
