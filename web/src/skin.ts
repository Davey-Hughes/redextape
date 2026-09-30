import { schemeName } from './base16'
import type { CustomPalette } from './custom-palette'
import { COLOUR_TOKENS, PALETTE_IDS, PALETTES, type Palette, type PaletteId } from './palettes'

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

/**
 * `custom` is the imported palette (Plan 7 part 6b spec §7.2), a choice only while one is stored: it is not in
 * `PALETTE_CHOICES`, and the palette select lists it after them when `custom-palette.ts`'s store holds a half.
 */
export type PaletteChoice = 'match' | PaletteId | 'custom'

/** The choices every page offers, in the select's order. */
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
  custom: 'custom',
}

/**
 * The palette select's words for the imported palette, a name per half — `custom — light: Day · dark: Ember
 * (adjusted)`, or `custom — dark: Ember` with one.
 */
export function customPaletteLabel(custom: CustomPalette): string {
  const halves = (['light', 'dark'] as const).flatMap((variant) => {
    const half = custom[variant]
    return half === undefined ? [] : [`${variant}: ${schemeName(half.name)}${half.adjusted ? ' (adjusted)' : ''}`]
  })
  return `${PALETTE_CHOICE_LABELS.custom} — ${halves.join(' · ')}`
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

/**
 * A stored palette choice, or `match` for anything that is not one — and for `custom` when nothing is imported, so a
 * store cleared or refused under a stored `custom` shows the style's own palette, with the select agreeing.
 */
export function readPaletteChoice(raw: string | null, custom: CustomPalette | null): PaletteChoice {
  if (raw === 'custom') return custom === null ? 'match' : 'custom'
  return isPaletteChoice(raw) ? raw : 'match'
}

/**
 * The palette a choice draws. For `custom`, each half is the style's own variant with that half's tokens written over
 * it, and a half not imported is the style's own (umbrella §7) — so it follows a style change.
 */
export function resolvePalette(style: StyleId, choice: PaletteChoice, custom: CustomPalette | null): Palette {
  if (choice !== 'custom') return PALETTES[choice === 'match' ? style : choice]
  const own = PALETTES[style]
  return {
    id: 'custom',
    name: PALETTE_CHOICE_LABELS.custom,
    light: { ...own.light, ...custom?.light?.tokens },
    dark: { ...own.dark, ...custom?.dark?.tokens },
  }
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
 * It returns nothing for the pre-paint cache: `main.ts` caches the palette storage resolves to,
 * `paletteDeclarations(resolvePalette(…))`, rather than the one drawn here. The two differ where storage refused a
 * write, to the imported palette or, silently, to the style or the palette choice.
 */
export function applySkin(root: SkinRoot, style: StyleId, choice: PaletteChoice, custom: CustomPalette | null): void {
  const palette = resolvePalette(style, choice, custom)
  root.setAttribute('data-style', style)
  for (const t of COLOUR_TOKENS) {
    root.style.setProperty(`--${t}`, `light-dark(${palette.light[t]}, ${palette.dark[t]})`)
  }
}
