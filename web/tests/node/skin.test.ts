import { describe, expect, it } from 'vitest'
import { COLOUR_TOKENS, PALETTE_CSS_PATTERN, PALETTE_IDS, PALETTES, paletteDeclarations } from '../../src/palettes'
import {
  applySkin,
  customPaletteLabel,
  DEFAULT_PALETTE,
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
import { adjustedHalf, beforeResult, CLOSING, DAY, NIGHT, storedHalf } from './base16-fixtures'

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
  it('defaults to the Instrument style and the Material palette', () => {
    expect(DEFAULT_STYLE).toBe('instrument')
    expect(readStyle(null)).toBe('instrument')
    expect(DEFAULT_PALETTE).toBe('material')
    expect(readPaletteChoice(null, null)).toBe('material')
  })

  it('offers Grayscale as a choice, not as the default', () => {
    expect(PALETTE_CHOICES).toContain('grayscale')
    expect(PALETTE_CHOICE_LABELS.grayscale).toBe('Grayscale')
    expect(DEFAULT_PALETTE).not.toBe('grayscale')
    expect(readPaletteChoice('grayscale', null)).toBe('grayscale')
    expect(resolvePalette('grayscale', null)).toBe(PALETTES.grayscale)
  })

  it('reads a stored style, and anything else as the default', () => {
    for (const s of STYLE_IDS) expect(readStyle(s)).toBe(s)
    for (const bad of ['', 'Paper', 'match', 'dark', 'instrument ']) expect(readStyle(bad)).toBe('instrument')
  })

  it('reads a stored palette choice, and anything else as the default palette', () => {
    for (const c of PALETTE_CHOICES) expect(readPaletteChoice(c, null)).toBe(c)
    for (const bad of [null, '', 'Paper', 'system', 'Custom']) {
      expect(readPaletteChoice(bad, null)).toBe(DEFAULT_PALETTE)
    }
  })

  it('keeps a stored choice over the default', () => {
    for (const id of PALETTE_IDS) expect(readPaletteChoice(id, null)).toBe(id)
  })

  // NO `match style`: the menu offers the built-in palettes alone, and a stored `match` reads as nothing stored
  // (tomorrow-palette design, its `match style` amendment).
  it('offers the built-in palettes and no match, and reads a stored match as the default palette', () => {
    expect(PALETTE_CHOICES).toEqual(PALETTE_IDS)
    expect(Object.keys(PALETTE_CHOICE_LABELS)).toEqual([...PALETTE_IDS, 'custom'])
    expect(readPaletteChoice('match', null)).toBe('material')
    expect(readPaletteChoice('match', { dark: storedHalf('Night', NIGHT) })).toBe('material')
  })

  it('resolves a named palette to itself', () => {
    for (const id of PALETTE_IDS) expect(resolvePalette(id, null)).toBe(PALETTES[id])
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
    const cached = paletteDeclarations(resolvePalette('terminal', null))
    expect(cached).toMatch(PALETTE_CSS_PATTERN)
    expect(cached).toContain(`--bg: light-dark(${PALETTES.terminal.light.bg}, ${PALETTES.terminal.dark.bg});`)
  })
})

/** The imported palette as a choice (Plan 7 part 6b spec §7.2). */
describe('skin — custom', () => {
  const night = storedHalf('Night', NIGHT)
  const day = { ...storedHalf('Day', DAY), adjusted: true }

  it('reads custom only while a half is stored, and the default palette otherwise', () => {
    expect(readPaletteChoice('custom', { dark: night })).toBe('custom')
    expect(readPaletteChoice('custom', null)).toBe(DEFAULT_PALETTE)
  })

  it('draws each stored half as stored, and the default palette’s variant for a half not stored', () => {
    const p = resolvePalette('custom', { dark: night })
    expect(p.id).toBe('custom')
    expect(p.dark).toEqual(night.tokens)
    expect(p.light).toEqual(PALETTES.material.light)
    const q = resolvePalette('custom', { light: day })
    expect(q.light).toEqual(day.tokens)
    expect(q.dark).toEqual(PALETTES.material.dark)
  })

  // COMPLETED, NOT FILLED FROM ANOTHER PALETTE: a token the half lacks is the one its own scheme gives, mapped and,
  // for an adjusted half, adjusted, so an import stored before a token existed draws it in the scheme's colours.
  it('completes a stored half that lacks a token from the colours it stored, not from the default palette', () => {
    const { fg: _, ...lacking } = night.tokens
    const p = resolvePalette('custom', { dark: { ...night, tokens: lacking } })
    expect(p.dark.fg).toBe(NIGHT[5])
    expect(p.dark.bg).toBe(NIGHT[0])
    const closing = adjustedHalf('Closing', CLOSING, 'dark')
    const q = resolvePalette('custom', { light: beforeResult(storedHalf('Day', DAY)), dark: beforeResult(closing) })
    expect([q.light.result, q.light['result-word']]).toEqual([DAY[11], DAY[11]])
    expect([q.dark.result, q.dark['result-word']]).toEqual([closing.tokens.result, closing.tokens['result-word']])
    expect(q.dark['result-word']).not.toBe(CLOSING[11])
    expect(q.light.result).not.toBe(PALETTES.material.light.result)
    expect(q.dark['result-word']).not.toBe(PALETTES.material.dark['result-word'])
  })

  it('draws the default palette for custom with nothing stored', () => {
    const p = resolvePalette('custom', null)
    expect([p.light, p.dark]).toEqual([PALETTES.material.light, PALETTES.material.dark])
  })

  it('applies a custom palette, and caches it as its resolved declarations', () => {
    const root = fakeRoot()
    applySkin(root, 'instrument', 'custom', { light: day, dark: night })
    expect(root.props.get('--bg')).toBe(`light-dark(${DAY[0]}, ${NIGHT[0]})`)
    const cached = paletteDeclarations(resolvePalette('custom', { light: day, dark: night }))
    expect(cached).toMatch(PALETTE_CSS_PATTERN)
    expect(cached).toContain(`--bg: light-dark(${DAY[0]}, ${NIGHT[0]});`)
  })

  it('names each half in the select, and says which were adjusted', () => {
    expect(customPaletteLabel({ light: day, dark: night })).toBe('custom — light: Day (adjusted) · dark: Night')
    expect(customPaletteLabel({ dark: { ...night, name: '' } })).toBe('custom — dark: untitled')
  })
})
