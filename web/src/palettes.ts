/**
 * Every colour the app draws with, as data (Plan 7 part 1, spec §3–§4).
 *
 * THE TOKEN LIST IS THE CONTRACT. `style.css` reads colours only through these names — directly or
 * through `color-mix()` of them — and `scripts/check-colours.sh` fails on a colour literal anywhere else
 * in the web sources but `style.css`'s fallback copy (below), so a palette that sets every token here
 * recolours everything. The `Variant` type makes a palette missing a token a compile error rather than a
 * blank colour.
 *
 * `style.css` keeps one copy of Instrument's values as the first-paint fallback, between its
 * `palette:fallback` markers; `palettes.test.ts` holds that copy equal to this one.
 *
 * Not every token has a consumer yet: `on-accent` and `warn` are defined now so their contrast is held
 * from the start, and parts 2 and 3 of Plan 7 use them.
 *
 * `tok-binder` IS THE ONE CLASS OUTSIDE THE MINI-LANGUAGE'S OWN THAT GETS A COLOUR RATHER THAN
 * `tok-neutral`, AND THE λ GRAMMAR IS WHY. `REDEXTAPE_LAMBDA` in `capture_map.rs` maps its captures to
 * exactly three classes — `Binder`, `Ident` and `Punct`. `tok-ident` is `fg` in all six variants and
 * `tok-punct` is `tok-neutral` or all but indistinguishable from it, so a λ editor whose binder also
 * drew `tok-neutral` had two colours for three classes, with `λf` and `(` the same pixels. The classes
 * the TM and asm forms add keep sharing `tok-neutral`: they arrive in editors that already colour a
 * keyword, a number and a state name apart. `palettes.test.ts`'s *keeps `tok-binder` apart from every
 * other token* is the gate, not this paragraph.
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
] as const

export type ColourToken = (typeof COLOUR_TOKENS)[number]

export type Variant = Readonly<Record<ColourToken, string>>

export const PALETTE_IDS = ['paper', 'terminal', 'instrument'] as const

export type PaletteId = (typeof PALETTE_IDS)[number]

export type Palette = {
  readonly id: PaletteId
  readonly name: string
  readonly light: Variant
  readonly dark: Variant
}

export const PALETTES: Readonly<Record<PaletteId, Palette>> = {
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
    },
  },
}

/**
 * A palette as CSS declarations — `--bg: light-dark(#…, #…); …`, one per token, in token order.
 *
 * This is the text the app caches after applying a palette, and the text the pre-paint script in
 * `index.html` writes onto `<html>` as the `style` attribute before first paint.
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
 * `index.html`'s pre-paint script carries this pattern as a literal — it runs before any module, so it
 * cannot import it — and applies a cached string to `<html>`'s `style` attribute only if the string
 * matches. `prepaint.test.ts` holds the literal equal to this `source`. A cache in any other form — corrupt,
 * stale in format, or written by anything else — is therefore ignored rather than injected.
 */
export const PALETTE_CSS_PATTERN = /^(--[a-z0-9-]+: light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\); ?)+$/
