import { describe, expect, it } from 'vitest'
import { COLOUR_TOKENS, PALETTES, paletteDeclarations } from '../../src/palettes'
import {
  applySkin,
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
    for (const c of PALETTE_CHOICES) expect(readPaletteChoice(c)).toBe(c)
    for (const bad of [null, '', 'Paper', 'system']) expect(readPaletteChoice(bad)).toBe('match')
  })

  it('resolves match to the style’s own palette, and a named palette to itself', () => {
    expect(resolvePalette('paper', 'match')).toBe(PALETTES.paper)
    expect(resolvePalette('paper', 'terminal')).toBe(PALETTES.terminal)
  })

  it('labels every style and every choice', () => {
    for (const s of STYLE_IDS) expect(STYLE_LABELS[s]).not.toBe('')
    for (const c of PALETTE_CHOICES) expect(PALETTE_CHOICE_LABELS[c]).not.toBe('')
  })

  it('writes the style attribute and every token, and returns the declarations to cache', () => {
    const root = fakeRoot()
    const cached = applySkin(root, 'paper', 'terminal')
    expect(root.attrs.get('data-style')).toBe('paper')
    for (const t of COLOUR_TOKENS) {
      expect(root.props.get(`--${t}`)).toBe(`light-dark(${PALETTES.terminal.light[t]}, ${PALETTES.terminal.dark[t]})`)
    }
    expect(cached).toBe(paletteDeclarations(PALETTES.terminal))
  })
})
