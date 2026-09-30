import { COLOUR_TOKENS, type ColourToken, type Variant } from './palettes'

/**
 * WCAG 2 relative luminance and contrast ratio, and the floors a palette is held to — the built-ins in
 * `palettes.test.ts`, and an imported base16 scheme before it is applied (Plan 7 part 6b). The two are held
 * to one table and one binder rule, so an import is checked against exactly what the built-ins meet.
 *
 * ONLY `#rrggbb`, deliberately. Every palette value is written that way (`palettes.test.ts` asserts it),
 * and a parser that also took shorthand, alpha or names would be code whose only callers are tests.
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = linearRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The contrast ratio between two colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * A colour's three channels, from 0 to 255 — THE ONE PLACE A COLOUR IS PARSED: for the luminance above, the binder
 * rule's channels below and `base16-adjust.ts`'s OKLCH, so none of them reads a malformed value as `NaN` and carries
 * on. Anything but `#rrggbb` throws, for the reason `relativeLuminance` gives.
 */
function rgbChannels(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex)
  if (m === null) throw new Error(`not a #rrggbb colour: ${JSON.stringify(hex)}`)
  const byte = (pair: string | undefined): number => Number.parseInt(pair ?? '00', 16)
  return [byte(m[1]), byte(m[2]), byte(m[3])]
}

/** A colour's three channels as linear light, from 0 to 1: sRGB's transfer function undone. */
export function linearRgb(hex: string): [number, number, number] {
  const linear = (byte: number): number => {
    const c = byte / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = rgbChannels(hex)
  return [linear(r), linear(g), linear(b)]
}

/**
 * Every pair a floor applies to, as `[foreground, background, floor]` — Plan 7 part 1 spec §12, test 1.
 *
 * 4.5 and 3 are WCAG 2's AA thresholds for text (1.4.3) and for non-text marks (1.4.11).
 */
export const CONTRAST_FLOORS: readonly (readonly [ColourToken, ColourToken, number])[] = [
  ...(['fg', 'fg-dim', ...COLOUR_TOKENS.filter((t) => t.startsWith('tok-'))] as ColourToken[]).flatMap(
    (t): [ColourToken, ColourToken, number][] => [
      [t, 'bg', 4.5],
      [t, 'bg-raised', 4.5],
    ],
  ),
  ['fg', 'bg-chrome', 4.5],
  ['fg-dim', 'bg-chrome', 4.5],
  ...(['focus-ring', 'warn'] as ColourToken[]).flatMap((t): [ColourToken, ColourToken, number][] => [
    [t, 'bg', 3],
    [t, 'bg-raised', 3],
    [t, 'bg-chrome', 3],
  ]),
  // `--accent` and `--error` also colour text on `--bg` and `--bg-raised`, so there they meet the text
  // floor, tighter than the 3:1 Plan 7 part 1 first set for both on every surface. Neither is text on
  // chrome.
  ...(['accent', 'error'] as ColourToken[]).flatMap((t): [ColourToken, ColourToken, number][] => [
    [t, 'bg', 4.5],
    [t, 'bg-raised', 4.5],
    [t, 'bg-chrome', 3],
  ]),
  ['on-accent', 'accent', 4.5],
]

/** How far apart, in some channel, `tok-binder` must sit from every other token. */
export const BINDER_APART = 24

/** A token `tok-binder` sits too close to, and how far apart the two are in their most distant channel. */
export type BinderClash = { readonly token: ColourToken; readonly apart: number }

/**
 * Every token `tok-binder` is within `BINDER_APART` of, in its most distant channel — empty when it stands apart
 * from all of them.
 *
 * `tok-binder` exists ONLY to be a different colour from the two other classes a λ editor can show, so a value
 * that drifted back onto a neighbour would leave the token in place and the defect intact.
 *
 * NOT A PERCEPTUAL GATE, AND NOT PRETENDING TO BE ONE. Whether two colours read apart is a judgement made by eye,
 * against a rendered editor; 24 in some channel is far below what the eye needs and far above what `tok-punct`
 * against `tok-neutral` scores in any built-in variant. What it catches is the failure that put this token here —
 * a class drawing a neighbour's exact value — not a poor choice of hue.
 *
 * SCOPED TO `tok-binder` rather than run over every pair, because two pairs are deliberately equal or all but:
 * `tok-nat` and `tok-bool` are one colour on purpose, and `tok-punct` sits on `tok-neutral` in the dark variants.
 * Widening this to all pairs is a palette change, not a rule change.
 */
export function binderClashes(v: Variant): BinderClash[] {
  const binder = rgbChannels(v['tok-binder'])
  const clashes: BinderClash[] = []
  for (const t of COLOUR_TOKENS) {
    if (t === 'tok-binder') continue
    const other = rgbChannels(v[t])
    const apart = Math.max(...binder.map((c, i) => Math.abs(c - (other[i] ?? 0))))
    if (apart < BINDER_APART) clashes.push({ token: t, apart })
  }
  return clashes
}
