import { COLOUR_TOKENS, PALETTE_IDS, PALETTES, type Palette, type PaletteId, paletteDeclarations } from './palettes'

/**
 * The style and palette a page is drawn in (Plan 7 part 1, spec §4 and §6).
 *
 * TWO CHOICES, NOT ONE. A style is shape — fonts, radius, label case — and lives in `style.css`'s
 * `[data-style]` blocks; a palette is colour and lives in `palettes.ts`. `match` means "the style's own
 * palette", which is what a visitor who never touches the palette control gets. The appearance toggle
 * (`appearance.ts`) is a third, independent choice and is untouched: every token is a `light-dark()` pair,
 * so light and dark follow `color-scheme` whichever palette is applied.
 */
export const STYLE_IDS = ['paper', 'terminal', 'instrument'] as const

export type StyleId = (typeof STYLE_IDS)[number]

export type PaletteChoice = 'match' | PaletteId

export const PALETTE_CHOICES: readonly PaletteChoice[] = ['match', ...PALETTE_IDS]

/** The first-visit style — the umbrella design's first-load decision. */
export const DEFAULT_STYLE: StyleId = 'instrument'

export const STYLE_KEY = 'redextape.style'
export const PALETTE_KEY = 'redextape.palette'

/**
 * The resolved declarations of the palette last applied, for `index.html`'s pre-paint script — which runs
 * before any module and so cannot resolve a choice itself. Written by `main.ts` whenever a palette is
 * applied.
 */
export const PALETTE_CSS_KEY = 'redextape.palette.css'

export const STYLE_LABELS: Readonly<Record<StyleId, string>> = {
  paper: 'Paper',
  terminal: 'Terminal',
  instrument: 'Instrument',
}

export const PALETTE_CHOICE_LABELS: Readonly<Record<PaletteChoice, string>> = {
  match: 'match style',
  paper: 'Paper',
  terminal: 'Terminal',
  instrument: 'Instrument',
}

function isStyle(raw: string | null): raw is StyleId {
  return raw !== null && (STYLE_IDS as readonly string[]).includes(raw)
}

function isPaletteChoice(raw: string | null): raw is PaletteChoice {
  return raw === 'match' || (raw !== null && (PALETTE_IDS as readonly string[]).includes(raw))
}

/** A stored style, or the default for anything that is not one — including a value from a later version. */
export function readStyle(raw: string | null): StyleId {
  return isStyle(raw) ? raw : DEFAULT_STYLE
}

/** A stored palette choice, or `match` for anything that is not one. */
export function readPaletteChoice(raw: string | null): PaletteChoice {
  return isPaletteChoice(raw) ? raw : 'match'
}

export function resolvePalette(style: StyleId, choice: PaletteChoice): Palette {
  return PALETTES[choice === 'match' ? style : choice]
}

/** The slice of `<html>` that `applySkin` writes to, so node tests can hand it a fake. */
export type SkinRoot = {
  setAttribute(name: string, value: string): void
  readonly style: { setProperty(name: string, value: string): void }
}

/**
 * Draw the page in `style` with the palette `choice` resolves to: `data-style` on `root`, and every
 * colour token as an inline `light-dark()` custom property, which wins over `style.css`'s fallback.
 *
 * Returns the palette's declarations, for the caller to cache under `PALETTE_CSS_KEY`.
 */
export function applySkin(root: SkinRoot, style: StyleId, choice: PaletteChoice): string {
  const palette = resolvePalette(style, choice)
  root.setAttribute('data-style', style)
  for (const t of COLOUR_TOKENS) {
    root.style.setProperty(`--${t}`, `light-dark(${palette.light[t]}, ${palette.dark[t]})`)
  }
  return paletteDeclarations(palette)
}
