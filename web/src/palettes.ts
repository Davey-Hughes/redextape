/**
 * Every colour the app draws with, as data (Plan 7 part 1, spec §3–§4).
 *
 * THE TOKEN LIST IS THE CONTRACT. `style.css` reads colours only through these names — directly or
 * through `color-mix()` of them — and `scripts/check-colours.sh` fails on a colour literal anywhere else
 * in the web sources but `style.css`'s fallback copy (below), so a palette that sets every token here
 * recolours everything. The `Variant` type makes a palette missing a token a compile error rather than a
 * blank colour.
 *
 * `style.css` keeps one copy of the default palette (`skin.ts`'s `DEFAULT_PALETTE`) as the first-paint
 * fallback, between its `palette:fallback` markers; `palettes.test.ts` holds that copy equal to this one.
 *
 * Not every token has a consumer: `on-accent` is defined so its contrast is held.
 *
 * `tok-binder` IS THE ONE CLASS OUTSIDE THE MINI-LANGUAGE'S OWN THAT GETS A COLOUR RATHER THAN
 * `tok-neutral`, AND THE λ VIEW IS WHY. Its binders sit among names, `tok-ident`, and punctuation,
 * `tok-punct`. `tok-ident` is `fg` in every built-in variant and `tok-punct` is `tok-neutral` or all but
 * indistinguishable from it, so a λ view whose binder also drew `tok-neutral` would draw `λf` and `(` in the
 * same pixels. The classes only the TM and rxm grammars reach share `tok-neutral`: the app loads neither
 * grammar, so it draws none of them. `palettes.test.ts`'s *keeps `tok-binder` apart from every other token*
 * is the gate, not this paragraph.
 */
export const COLOUR_TOKENS = [
  'bg',
  'bg-raised',
  'bg-chrome',
  'rule',
  'fg',
  'fg-dim',
  'accent',
  'on-accent',
  'focus-ring',
  'error',
  'warn',
  'tok-neutral',
  'tok-keyword',
  'tok-ident',
  'tok-nat',
  'tok-bool',
  'tok-operator',
  'tok-punct',
  'tok-binder',
  // TWO TOKENS BECAUSE THE WORD IS READ ON THE MARK: `result` is a result mark's edge and, mixed over the surface
  // (`style.css`'s `--result-bg`), its ground; `result-word` is the word on that ground, held to the text floor there
  // (`contrast.ts`'s `groundOf`). Each colour palette's `result` stands `BINDER_APART` from every token but
  // `result-word`, so the mark reads as no other; Grayscale's is a grey of its ramp, and its edge and word carry it.
  'result',
  'result-word',
] as const

export type ColourToken = (typeof COLOUR_TOKENS)[number]

export type Variant = Readonly<Record<ColourToken, string>>

export const PALETTE_IDS = ['material', 'paper', 'terminal', 'instrument', 'grayscale'] as const

export type PaletteId = (typeof PALETTE_IDS)[number]

/** A built-in palette, or the imported one (`skin.ts`'s `resolvePalette`), which is `custom`. */
export type Palette = {
  readonly id: PaletteId | 'custom'
  readonly name: string
  readonly light: Variant
  readonly dark: Variant
}

export const PALETTES: Readonly<Record<PaletteId, Palette>> = {
  /**
   * The base16 schemes Material Darker (dark) and Material Lighter (light) by Nate Peterson, ports of Mattia
   * Astorino's Material Theme, from tinted-theming/schemes, MIT. The first amendment in
   * `docs/superpowers/specs/2026-11-14-tomorrow-palette-design.md` lists each slot's source. `base16-adjust.ts`'s
   * `adjustVariant` moved what fell below `CONTRAST_FLOORS`, keeping its hue. The light port's base05 is the
   * theme's teal selection colour, which reads teal as text, so the light half takes Material Lighter's own text
   * (`#546e7a`) and comment (`#90a4ae`) colours as base05 and base03, and its `rule` is the port's base03 rather
   * than base02's teal. `tok-binder` is green, base0B, not red: red is `error`, and `contrast.ts`'s
   * `binderClashes` holds `tok-binder` apart from every other token, `error` included.
   */
  material: {
    id: 'material',
    name: 'Material',
    light: {
      bg: '#fafafa',
      'bg-raised': '#e7eaec',
      'bg-chrome': '#fafafa',
      rule: '#ccd7da',
      fg: '#546d79',
      'fg-dim': '#5a6c76',
      accent: '#4b6a9f',
      'on-accent': '#fafafa',
      'focus-ring': '#546e7a',
      error: '#cd1a49',
      warn: '#b37b00',
      'tok-neutral': '#5a6c76',
      'tok-keyword': '#7442f5',
      'tok-ident': '#546d79',
      'tok-nat': '#c03a0d',
      'tok-bool': '#c03a0d',
      'tok-operator': '#00757c',
      'tok-punct': '#5a6c76',
      'tok-binder': '#527407',
      result: '#047857',
      'result-word': '#065f46',
    },
    dark: {
      bg: '#212121',
      'bg-raised': '#303030',
      'bg-chrome': '#212121',
      rule: '#353535',
      fg: '#eeffff',
      'fg-dim': '#979797',
      accent: '#82aaff',
      'on-accent': '#212121',
      'focus-ring': '#eeffff',
      error: '#f07178',
      warn: '#ffcb6b',
      'tok-neutral': '#979797',
      'tok-keyword': '#c792ea',
      'tok-ident': '#eeffff',
      'tok-nat': '#f78c6c',
      'tok-bool': '#f78c6c',
      'tok-operator': '#89ddff',
      'tok-punct': '#979797',
      'tok-binder': '#c3e88d',
      result: '#34d399',
      'result-word': '#34d399',
    },
  },
  paper: {
    id: 'paper',
    name: 'Paper',
    light: {
      bg: '#f7f4ef',
      'bg-raised': '#fffdf9',
      'bg-chrome': '#efeae1',
      rule: '#ddd5c8',
      fg: '#221f1b',
      'fg-dim': '#645d54',
      accent: '#9a3412',
      'on-accent': '#ffffff',
      'focus-ring': '#221f1b',
      error: '#b91c1c',
      warn: '#92400e',
      'tok-neutral': '#645d54',
      'tok-keyword': '#9a3412',
      'tok-ident': '#221f1b',
      'tok-nat': '#1d4ed8',
      'tok-bool': '#1d4ed8',
      'tok-operator': '#7c2d92',
      'tok-punct': '#665f56',
      'tok-binder': '#166b16',
      result: '#1f7a4d',
      'result-word': '#17603c',
    },
    dark: {
      bg: '#191714',
      'bg-raised': '#211e1a',
      'bg-chrome': '#24211c',
      rule: '#3a352d',
      fg: '#ece7de',
      'fg-dim': '#a89f94',
      accent: '#f0956a',
      'on-accent': '#1a1613',
      'focus-ring': '#ece7de',
      error: '#f87171',
      warn: '#fbbf24',
      'tok-neutral': '#a89f94',
      'tok-keyword': '#f0956a',
      'tok-ident': '#ece7de',
      'tok-nat': '#86b6ff',
      'tok-bool': '#86b6ff',
      'tok-operator': '#d6a2f0',
      'tok-punct': '#a39a8f',
      'tok-binder': '#86c47a',
      result: '#62d394',
      'result-word': '#62d394',
    },
  },
  terminal: {
    id: 'terminal',
    name: 'Terminal',
    light: {
      bg: '#f4f6f2',
      'bg-raised': '#fbfdf9',
      'bg-chrome': '#e8ece4',
      rule: '#cfd8ca',
      fg: '#14251a',
      'fg-dim': '#4b5e51',
      accent: '#136c2e',
      'on-accent': '#fbfdf9',
      'focus-ring': '#14251a',
      error: '#b42318',
      warn: '#8a5a00',
      'tok-neutral': '#4b5e51',
      'tok-keyword': '#b1331f',
      'tok-ident': '#14251a',
      'tok-nat': '#12548f',
      'tok-bool': '#12548f',
      'tok-operator': '#6b2fa0',
      'tok-punct': '#526457',
      'tok-binder': '#a51375',
      result: '#0b7a5a',
      'result-word': '#065f46',
    },
    dark: {
      bg: '#0b0e14',
      'bg-raised': '#0f131b',
      'bg-chrome': '#141a24',
      rule: '#222b38',
      fg: '#d3dae6',
      'fg-dim': '#8b97aa',
      accent: '#39d353',
      'on-accent': '#06110a',
      'focus-ring': '#d3dae6',
      error: '#ff7b72',
      warn: '#e3b341',
      'tok-neutral': '#8b97aa',
      'tok-keyword': '#ff7b72',
      'tok-ident': '#d3dae6',
      'tok-nat': '#79c0ff',
      'tok-bool': '#79c0ff',
      'tok-operator': '#d2a8ff',
      'tok-punct': '#8b97aa',
      'tok-binder': '#f76fc6',
      result: '#34d399',
      'result-word': '#34d399',
    },
  },
  instrument: {
    id: 'instrument',
    name: 'Instrument',
    light: {
      bg: '#e9edf2',
      'bg-raised': '#ffffff',
      'bg-chrome': '#f4f7fa',
      rule: '#c8d3de',
      fg: '#152430',
      'fg-dim': '#4a5f72',
      accent: '#0f766e',
      'on-accent': '#ffffff',
      'focus-ring': '#152430',
      error: '#b42318',
      warn: '#8a5a00',
      'tok-neutral': '#4a5f72',
      'tok-keyword': '#0b5fb3',
      'tok-ident': '#152430',
      'tok-nat': '#9a3412',
      'tok-bool': '#9a3412',
      'tok-operator': '#6d28d9',
      'tok-punct': '#4f6477',
      'tok-binder': '#9f1188',
      result: '#15803d',
      'result-word': '#166534',
    },
    dark: {
      bg: '#101820',
      'bg-raised': '#16202a',
      'bg-chrome': '#122029',
      rule: '#273947',
      fg: '#dbe6ef',
      'fg-dim': '#8ea3b5',
      accent: '#2dd4bf',
      'on-accent': '#06201d',
      'focus-ring': '#dbe6ef',
      error: '#f97066',
      warn: '#fdb022',
      'tok-neutral': '#8ea3b5',
      'tok-keyword': '#5fa8f5',
      'tok-ident': '#dbe6ef',
      'tok-nat': '#f0956a',
      'tok-bool': '#f0956a',
      'tok-operator': '#c4a8f5',
      'tok-punct': '#8ea3b5',
      'tok-binder': '#f472dc',
      result: '#4ade80',
      'result-word': '#4ade80',
    },
  },
  /**
   * The base16 schemes Grayscale Dark and Grayscale Light by Alexandre Gavioli, from tinted-theming/schemes, MIT,
   * in Material's slot roles with no hand change; `2026-11-14-tomorrow-palette-design.md`'s second amendment lists
   * each slot's source. `adjustVariant` moved what fell below `CONTRAST_FLOORS`, so the tokens read apart by
   * brightness rather than hue, and `accent` and `error` share a grey. That is the scheme's nature, not a fault in
   * the mapping.
   */
  grayscale: {
    id: 'grayscale',
    name: 'Grayscale',
    light: {
      bg: '#f7f7f7',
      'bg-raised': '#e3e3e3',
      'bg-chrome': '#f7f7f7',
      rule: '#b9b9b9',
      fg: '#464646',
      'fg-dim': '#656565',
      accent: '#656565',
      'on-accent': '#f7f7f7',
      'focus-ring': '#464646',
      error: '#656565',
      warn: '#818181',
      'tok-neutral': '#656565',
      'tok-keyword': '#656565',
      'tok-ident': '#464646',
      'tok-nat': '#656565',
      'tok-bool': '#656565',
      'tok-operator': '#656565',
      'tok-punct': '#656565',
      'tok-binder': '#2e2e2e',
      result: '#464646',
      'result-word': '#2e2e2e',
    },
    dark: {
      bg: '#101010',
      'bg-raised': '#252525',
      'bg-chrome': '#101010',
      rule: '#464646',
      fg: '#b9b9b9',
      'fg-dim': '#8c8b8b',
      accent: '#8c8c8c',
      'on-accent': '#101010',
      'focus-ring': '#b9b9b9',
      error: '#8c8c8c',
      warn: '#a0a0a0',
      'tok-neutral': '#8c8b8b',
      'tok-keyword': '#8c8c8b',
      'tok-ident': '#b9b9b9',
      'tok-nat': '#999999',
      'tok-bool': '#999999',
      'tok-operator': '#8c8c8b',
      'tok-punct': '#8c8b8b',
      'tok-binder': '#d1d1d1',
      result: '#b9b9b9',
      'result-word': '#d1d1d1',
    },
  },
}

/**
 * A palette as CSS declarations — `--bg: light-dark(#…, #…); …`, one per token, in token order.
 *
 * This is the text the app caches after applying a palette, and the text the pre-paint script
 * (`prepaint.ts`) writes onto `<html>` as the `style` attribute before first paint.
 */
export function paletteDeclarations(p: Palette): string {
  return COLOUR_TOKENS.map((t) => `--${t}: light-dark(${p.light[t]}, ${p.dark[t]});`).join(' ')
}

/**
 * What a cached palette must be to be applied: one or more custom-property declarations, each set to a
 * `light-dark(#rrggbb, #rrggbb)` pair — the form `paletteDeclarations` writes. It does not hold the names
 * to `COLOUR_TOKENS` or reject a repeated one; what it guarantees is that nothing but a custom property set
 * to a pair of hex colours can pass.
 *
 * `prepaint.ts`'s `PREPAINT` carries this pattern as a literal — it runs before any module, so it
 * cannot import it — and applies a cached string to `<html>`'s `style` attribute only if the string
 * matches. `prepaint.test.ts` holds the literal equal to this `source`. A cache in any other form — corrupt,
 * stale in format, or written by anything else — is therefore ignored rather than injected.
 */
export const PALETTE_CSS_PATTERN = /^(--[a-z0-9-]+: light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\); ?)+$/
