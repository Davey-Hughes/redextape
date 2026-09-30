import { BASE16_KEYS, type Base16Key, type SchemeVariant } from './base16'
import { COLOUR_TOKENS, type ColourToken } from './palettes'

/**
 * The one imported palette, `custom` (Plan 7 part 6b spec §7.1): a half per variant, each the scheme it came from
 * and the tokens it applies.
 *
 * **`tokens` IS STORED, NOT RECOMPUTED FROM `colours`**, so a later change to the mapping or the adjustment never
 * repaints a palette someone has already applied. `colours` is kept beside it so the dialog can show what an
 * adjustment changed.
 */

/** The `localStorage` key, namespaced for the reason `appearance.ts`'s `STORAGE_KEY` gives. */
export const CUSTOM_PALETTE_KEY = 'redextape.palette.custom'

/** Bumped when the stored shape changes. A mismatch reads as nothing imported rather than migrating. */
export const CUSTOM_PALETTE_VERSION = 1

/** One variant's import. */
export type CustomHalf = {
  /** `''` when the scheme names none; shown as `untitled`. */
  readonly name: string
  /** The scheme's own sixteen, as read. */
  readonly colours: Readonly<Record<Base16Key, string>>
  /** What is applied. A token missing here falls back to the style's own palette. */
  readonly tokens: Readonly<Partial<Record<ColourToken, string>>>
  /** Whether `apply adjusted` wrote `tokens`. */
  readonly adjusted: boolean
}

/**
 * The imported palette: a light half, a dark half, or both. **NEVER NEITHER** — a store with no half left is removed,
 * and reads as `null`, so an empty store and no store are one state; the type holds that as well, a union with one
 * half required in each arm.
 */
export type CustomPalette =
  | { readonly light: CustomHalf; readonly dark?: CustomHalf }
  | { readonly light?: CustomHalf; readonly dark: CustomHalf }

/**
 * The one form a stored colour may take: every token reaches `index.html`'s pre-paint cache, whose pattern
 * (`palettes.ts`'s `PALETTE_CSS_PATTERN`) admits nothing else.
 */
const HEX = /^#[0-9a-f]{6}$/

function readHalf(node: unknown): CustomHalf | null {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return null
  const n = node as Record<string, unknown>
  if (typeof n.name !== 'string' || typeof n.adjusted !== 'boolean') return null
  if (typeof n.colours !== 'object' || n.colours === null) return null
  // AN ARRAY IS AN OBJECT TO `typeof`, and its entries are no token's, so one would read as a half with no tokens.
  if (typeof n.tokens !== 'object' || n.tokens === null || Array.isArray(n.tokens)) return null
  const stored = n.colours as Record<string, unknown>
  const colours: Partial<Record<Base16Key, string>> = {}
  for (const k of BASE16_KEYS) {
    const value = stored[k]
    if (typeof value !== 'string' || !HEX.test(value)) return null
    colours[k] = value
  }
  const tokens: Partial<Record<ColourToken, string>> = {}
  for (const [t, value] of Object.entries(n.tokens)) {
    // A NAME `COLOUR_TOKENS` DOES NOT HOLD IS DROPPED, not refused: nothing reads it, and a token a later version
    // retires would otherwise refuse every palette stored before it.
    const token = COLOUR_TOKENS.find((c) => c === t)
    if (token === undefined) continue
    if (typeof value !== 'string' || !HEX.test(value)) return null
    tokens[token] = value
  }
  return { name: n.name, colours: colours as Record<Base16Key, string>, tokens, adjusted: n.adjusted }
}

/**
 * The stored palette, or `null` for nothing usable — refused whole, as `buffers-store.ts`'s `parseBuffers` refuses,
 * without a notice, since a failed read cannot be told from a first visit: not JSON, another `version`, a half that is
 * not an object, a `name` that is not a string, `colours` without one of the sixteen or holding anything but lowercase
 * `#rrggbb`, an `adjusted` that is not a boolean, `tokens` that are not an object or are an array, or a token holding
 * anything but lowercase `#rrggbb`.
 */
export function parseCustomPalette(raw: string | null): CustomPalette | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const envelope = parsed as Record<string, unknown>
  if (envelope.version !== CUSTOM_PALETTE_VERSION) return null
  const halves: Partial<Record<SchemeVariant, CustomHalf>> = {}
  for (const variant of ['light', 'dark'] as const) {
    if (!(variant in envelope)) continue
    const half = readHalf(envelope[variant])
    if (half === null) return null
    halves[variant] = half
  }
  return palette(halves.light, halves.dark)
}

/** The palette of these halves, or `null` when neither is there: the one place a palette's needing a half is met. */
function palette(light: CustomHalf | undefined, dark: CustomHalf | undefined): CustomPalette | null {
  if (light !== undefined) return dark === undefined ? { light } : { light, dark }
  return dark === undefined ? null : { dark }
}

export function serializeCustomPalette(palette: CustomPalette): string {
  return JSON.stringify({ version: CUSTOM_PALETTE_VERSION, ...palette })
}

/** An import: `half` replaces `variant`'s half, and the other half is kept. */
export function withHalf(stored: CustomPalette | null, variant: SchemeVariant, half: CustomHalf): CustomPalette {
  return variant === 'light' ? { ...stored, light: half } : { ...stored, dark: half }
}

/** A remove: `variant`'s half goes and the other is kept — or `null` when it was the last, and the key goes too. */
export function withoutHalf(stored: CustomPalette, variant: SchemeVariant): CustomPalette | null {
  return variant === 'light' ? palette(undefined, stored.dark) : palette(stored.light, undefined)
}
