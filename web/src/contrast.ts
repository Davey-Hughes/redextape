import { COLOUR_TOKENS, type ColourToken, type Variant } from './palettes'

/**
 * WCAG 2 relative luminance and contrast ratio, and the floors a palette is held to — the built-ins in
 * `palettes.test.ts`, and an imported base16 scheme before it is applied (Plan 7 part 6b spec §5.3). The two are
 * held to one table and one binder rule, so an import is checked against exactly what the built-ins meet.
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
 * The share of `result` in a result mark's ground: `style.css`'s `--result-bg` mixes `--result` at this share, and
 * `palettes.test.ts` holds the two equal, so the word's floor is measured on the ground the browser draws.
 */
export const RESULT_TINT = 0.2

/**
 * `tint` at `share` over `over`, as the browser composites a colour of that opacity onto an opaque surface: per sRGB
 * channel, `round(share · tint + (1 − share) · over)`.
 */
export function tinted(tint: string, over: string, share = RESULT_TINT): string {
  const under = rgbChannels(over)
  const mixed = rgbChannels(tint).map((c, i) => Math.round(share * c + (1 - share) * (under[i] ?? 0)))
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/**
 * A floor: `fg` meets `floor` on `bg` or, with a `tint`, on `tint` at `RESULT_TINT` over `bg`, the ground a mark
 * draws under the text it carries.
 */
export type Floor = readonly [fg: ColourToken, bg: ColourToken, floor: number, tint?: ColourToken]

/**
 * Every floor: a foreground on a surface, or on a mark's tint over one — Plan 7 part 1 spec §12, test 1.
 *
 * 4.5 and 3 are WCAG 2's AA thresholds for text (1.4.3) and for non-text marks (1.4.11).
 */
export const CONTRAST_FLOORS: readonly Floor[] = [
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
  // floor. Neither is text on chrome.
  ...(['accent', 'error'] as ColourToken[]).flatMap((t): [ColourToken, ColourToken, number][] => [
    [t, 'bg', 4.5],
    [t, 'bg-raised', 4.5],
    [t, 'bg-chrome', 3],
  ]),
  ['on-accent', 'accent', 4.5],
  // THE RESULT MARK: its edge is a non-text mark on the page and on panels, and its word is text read on the mark's
  // own ground, which is lighter or darker than the surface under it, so the surface alone would overstate it.
  ['result', 'bg', 3],
  ['result', 'bg-raised', 3],
  ['result-word', 'bg', 4.5, 'result'],
  ['result-word', 'bg-raised', 4.5, 'result'],
]

/** The colour a floor's foreground is read on: its `bg`, or its `tint` composited over that. */
export function groundOf(v: Variant, floor: Floor): string {
  const [, bg, , tint] = floor
  return tint === undefined ? v[bg] : tinted(v[tint], v[bg])
}

/** How far apart, in some channel, `tok-binder` must sit from every other token. */
export const BINDER_APART = 24

/** A token another sits too close to, and how far apart the two are in their most distant channel. */
export type BinderClash = { readonly token: ColourToken; readonly apart: number }

/**
 * Every token but `token` and those in `except` that `token` is within `BINDER_APART` of, in its most distant channel:
 * the binder rule's measure, which `palettes.test.ts` also holds each built-in's `result` to.
 */
export function tooClose(v: Variant, token: ColourToken, except: readonly ColourToken[]): BinderClash[] {
  const own = rgbChannels(v[token])
  const clashes: BinderClash[] = []
  for (const t of COLOUR_TOKENS) {
    if (t === token || except.includes(t)) continue
    const other = rgbChannels(v[t])
    const apart = Math.max(...own.map((c, i) => Math.abs(c - (other[i] ?? 0))))
    if (apart < BINDER_APART) clashes.push({ token: t, apart })
  }
  return clashes
}

/**
 * Every token but `result` and `result-word` that `tok-binder` is within `BINDER_APART` of, in its most distant
 * channel — empty when it stands apart from all of them.
 *
 * `tok-binder` exists ONLY to be a different colour from its neighbours in the λ view, `tok-ident` and `tok-punct`,
 * so a value that drifted back onto one of them would leave the token in place and the defect intact.
 *
 * NOT A PERCEPTUAL GATE, AND NOT PRETENDING TO BE ONE. Whether two colours read apart is a judgement made by eye,
 * against a rendered editor; 24 in some channel is far below what the eye needs and far above what `tok-punct`
 * against `tok-neutral` scores in any built-in variant. What it catches is the failure that put this token here —
 * a class drawing a neighbour's exact value — not a poor choice of hue.
 *
 * SCOPED TO `tok-binder` rather than run over every pair, because two pairs are deliberately equal or all but:
 * `tok-nat` and `tok-bool` are one colour on purpose, and `tok-punct` is `tok-neutral`, or all but, in every
 * built-in variant. Widening this to all pairs is a palette change, not a rule change.
 */
export function binderClashes(v: Variant): BinderClash[] {
  // THE RESULT TOKENS ARE LEFT OUT: an import gives them base0B, the binder's own colour, so the rule would fail every
  // import. A result mark is not told by its hue alone: its edge, its ground and its word say what it is.
  return tooClose(v, 'tok-binder', ['result', 'result-word'])
}
