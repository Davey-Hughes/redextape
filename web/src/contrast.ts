/**
 * WCAG 2 relative luminance and contrast ratio, for holding palettes to their contrast floors — the
 * built-ins in `palettes.test.ts` now, and an imported base16 palette before it is applied in Plan 7
 * part 6.
 *
 * ONLY `#rrggbb`, deliberately. Every palette value is written that way (`palettes.test.ts` asserts it),
 * and a parser that also took shorthand, alpha or names would be code whose only callers are tests.
 */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex)
  if (m === null) throw new Error(`not a #rrggbb colour: ${JSON.stringify(hex)}`)
  const channel = (pair: string | undefined): number => {
    const c = Number.parseInt(pair ?? '00', 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(m[1]) + 0.7152 * channel(m[2]) + 0.0722 * channel(m[3])
}

/** The contrast ratio between two colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
