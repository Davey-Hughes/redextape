import { binderClashes, CONTRAST_FLOORS, contrastRatio, linearRgb, relativeLuminance } from './contrast'
import { COLOUR_TOKENS, type ColourToken, type Variant } from './palettes'

/**
 * `apply adjusted` (Plan 7 part 6b spec §6): THE FLOORS DO NOT CHANGE; THE SCHEME DOES, BY AS LITTLE AS IT CAN. Each
 * foreground token that fails a floor has its lightness moved, its hue kept, until it meets every floor it has; then
 * `tok-binder` moves the same way if it sits too close to another token. No surface moves — `bg`, `bg-raised`,
 * `bg-chrome` and `rule` are never walked, whatever a floor table names as a foreground.
 *
 * **LIGHTNESS MOVES IN OKLCH**, Björn Ottosson's OKLab in lightness, chroma and hue, by his published matrices. Its
 * `L` is perceptual, so a step of `L` is a similar visible step whatever the hue, which HSL's lightness is not; and
 * holding its hue angle holds the perceived hue, where CIELab's drifts toward purple in blue. CSS Color 4 gamut-maps
 * in it for the same reasons.
 */

/** A colour in OKLCH: lightness from 0 to 1, chroma, and hue in radians. */
export type Oklch = { readonly L: number; readonly C: number; readonly h: number }

const fromLinear = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

/** A `#rrggbb` colour in OKLCH. Anything else throws, as `contrast.ts`'s `relativeLuminance` does. */
export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = linearRgb(hex)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) }
}

/** Linear sRGB, unclamped: a channel outside 0 to 1 is a colour sRGB cannot show. */
function linearOf({ L, C, h }: Oklch): [number, number, number] {
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (rgb: readonly number[]): boolean => rgb.every((c) => c >= -1e-6 && c <= 1 + 1e-6)

/**
 * The `#rrggbb` nearest `c`: where `c` is outside sRGB, its chroma is reduced by bisection, at the same lightness
 * and hue, to the largest that is inside, and the result is rounded to eight bits a channel.
 */
export function oklchToHex(c: Oklch): string {
  let rgb = linearOf(c)
  if (!inGamut(rgb)) {
    let lo = 0
    let hi = c.C
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(linearOf({ ...c, C: mid }))) lo = mid
      else hi = mid
    }
    rgb = linearOf({ ...c, C: lo })
  }
  const byte = (v: number): string =>
    Math.round(fromLinear(Math.min(1, Math.max(0, v))) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${rgb.map(byte).join('')}`
}

/** How far the walk moves lightness at a time, and how many halvings then find the edge. */
const STEP = 0.01
const BISECTIONS = 16

/** How many steps the fine scan cuts lightness into: every 1/10,000 of it. */
const FINE = 10_000

/**
 * Every colour `from`'s lightness rounds to, from 0 to 1 in steps of `1 / FINE` at its own hue and chroma, each once,
 * the nearest `from` first.
 */
function fineScan(from: Oklch): readonly string[] {
  const own = Math.round(from.L * FINE)
  const seen = new Set<string>()
  for (let k = 0; k <= FINE; k++) {
    for (const i of k === 0 ? [own] : [own + k, own - k]) {
      if (i >= 0 && i <= FINE) seen.add(oklchToHex({ ...from, L: i / FINE }))
    }
  }
  return [...seen]
}

/**
 * The colour nearest `from` in lightness, its hue kept, for which `ok` holds — or `null` when no lightness does
 * (spec §6.2).
 *
 * **`ok` IS ASKED OF THE ROUNDED `#rrggbb`**, so the value returned is the value that passed. From `from`'s own `L`,
 * in each direction, it walks in steps of `STEP` until one passes or `L` reaches 0 or 1, then bisects between that
 * step and the one before, keeping the passing end; the direction with the smaller change wins. THE WALK COMES FIRST
 * because `ok` is not monotone from the token's own value when its surfaces sit on both sides of it — contrast with
 * one rises as contrast with the other falls — and the first region where it holds is the nearest.
 *
 * **BEFORE IT SAYS NO LIGHTNESS PASSES, A FINE SCAN**, `scan`'s colours asked of `ok` nearest first. A region where
 * `ok` holds can be narrower than one step of the walk, which then steps over it: `NIGHT`'s warning on black beside a
 * `#aaaaaa` panel meets 3:1 on both only for lightness 0.4650 to 0.4655, and the walk lands on 0.4731 and 0.4631. The
 * walk stays the fast path, and the scan runs only where it found nothing.
 */
function nearestLightness(from: Oklch, ok: (hex: string) => boolean, scan: () => readonly string[]): string | null {
  let best: { readonly hex: string; readonly dL: number } | null = null
  for (const dir of [1, -1]) {
    const room = dir > 0 ? 1 - from.L : from.L
    const at = (d: number): string => oklchToHex({ ...from, L: from.L + dir * d })
    let prev = 0
    for (let k = 1; ; k++) {
      const d = Math.min(k * STEP, room)
      if (ok(at(d))) {
        let lo = prev
        let hi = d
        for (let i = 0; i < BISECTIONS; i++) {
          const mid = (lo + hi) / 2
          if (ok(at(mid))) hi = mid
          else lo = mid
        }
        if (best === null || hi < best.dL) best = { hex: at(hi), dL: hi }
        break
      }
      prev = d
      if (d >= room) break
    }
  }
  return best?.hex ?? scan().find(ok) ?? null
}

/**
 * Whether any luminance meets every floor in `against`, each `[the luminance of the colour a floor is against, the
 * floor]`. **CONTRAST IS A MATTER OF TWO LUMINANCES ALONE**, so where none does, no colour of any hue or lightness can,
 * and a walk and a fine scan would ask every lightness for nothing: 4.5:1 on both black and `#aaaaaa` needs a luminance
 * of 0.175 or more and of 0.050 or less.
 *
 * A floor `f` against luminance `y` holds up to `(y + 0.05) / f − 0.05` and again from `f(y + 0.05) − 0.05`, so where
 * the luminances that meet every floor begin, they begin at 0 or at one of those second bounds, and only those are
 * asked; each is asked with a margin that errs toward yes, so a rounding error can cost a scan and never a colour.
 */
export function someLuminancePasses(against: readonly (readonly [number, number])[]): boolean {
  const ratio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  const starts = [0, ...against.map(([y, floor]) => floor * (y + 0.05) - 0.05)].map((y) => Math.min(1, Math.max(0, y)))
  return starts.some((y) => against.every(([other, floor]) => ratio(y, other) >= floor - 1e-9))
}

/** A token the adjustment moved: its imported value and the value applied. */
export type Moved = { readonly token: ColourToken; readonly from: string; readonly to: string }

/**
 * A token no lightness could fix: it keeps the value it had when its walk began, and still fails its floors or the
 * binder rule. That is its imported value, but for a binder the floors moved and the binder rule then could not: it
 * keeps the value that meets its floors.
 */
export type Unfixed = { readonly token: ColourToken; readonly rule: 'floors' | 'binder' }

export type Adjustment = {
  /** Every token as `apply adjusted` applies it. */
  readonly tokens: Variant
  readonly moved: readonly Moved[]
  readonly unfixed: readonly Unfixed[]
}

/**
 * The surfaces a foreground sits on, which never move (spec §6). `CONTRAST_FLOORS` names none as a foreground, and they
 * are held here as well, so a floor that did would not move the page under the text it is measured against.
 */
const SURFACES: readonly ColourToken[] = ['bg', 'bg-raised', 'bg-chrome', 'rule']

/**
 * Adjust a mapped scheme (spec §6.3).
 *
 * - **A token meets all its floors at once**: `ok` is their conjunction.
 * - **Tokens move independently**, even when they share a scheme colour, so `fg` and `focus-ring`, both base05, can
 *   end different.
 * - **The order**: first every foreground whose floors are against surfaces only; then `on-accent`, whose floor is
 *   against `accent`, checked against the `accent` the first pass ended with.
 * - **`tok-binder` last**: if it clashes, the same walk runs on it with `ok` = its floors hold and it stands apart
 *   from every other token's final value.
 * - **When no lightness passes**, the token keeps the value its walk began from, every other token is still adjusted,
 *   and the result names it (spec §6.4).
 *
 * `floors` is `CONTRAST_FLOORS` for every caller but one test, which hands it a table naming a surface as a
 * foreground to show the surfaces are held by this function and not by that table's data.
 */
export function adjustVariant(imported: Variant, floors: typeof CONTRAST_FLOORS = CONTRAST_FLOORS): Adjustment {
  const v: Record<ColourToken, string> = { ...imported }
  const unfixed: Unfixed[] = []
  const floorsOf = (t: ColourToken) => floors.filter(([fg]) => fg === t)
  const meets = (t: ColourToken, hex: string): boolean =>
    floorsOf(t).every(([, bg, floor]) => contrastRatio(hex, v[bg]) >= floor)
  const onSurfaces = (t: ColourToken): boolean => floorsOf(t).every(([, bg]) => SURFACES.includes(bg))
  // EACH COLOUR'S FINE SCAN IS MADE ONCE: the tokens that share a scheme colour, and fail, scan the same colours. AND
  // NONE IS MADE WHERE NO LUMINANCE MEETS THE TOKEN'S FLOORS, against colours that hold still while it walks: the
  // surfaces, and for `on-accent` the `accent` the first pass ended with.
  const scans = new Map<string, readonly string[]>()
  const nearest = (t: ColourToken, ok: (hex: string) => boolean): string | null => {
    if (!someLuminancePasses(floorsOf(t).map(([, bg, floor]) => [relativeLuminance(v[bg]), floor]))) return null
    const hex = v[t]
    return nearestLightness(hexToOklch(hex), ok, () => {
      const scan = scans.get(hex) ?? fineScan(hexToOklch(hex))
      scans.set(hex, scan)
      return scan
    })
  }
  const walked = COLOUR_TOKENS.filter((t) => !SURFACES.includes(t) && floorsOf(t).length > 0)
  for (const t of [...walked.filter(onSurfaces), ...walked.filter((t) => !onSurfaces(t))]) {
    if (meets(t, v[t])) continue
    const hex = nearest(t, (candidate) => meets(t, candidate))
    if (hex === null) unfixed.push({ token: t, rule: 'floors' })
    else v[t] = hex
  }
  if (binderClashes(v).length > 0) {
    const hex = nearest(
      'tok-binder',
      (candidate) => meets('tok-binder', candidate) && binderClashes({ ...v, 'tok-binder': candidate }).length === 0,
    )
    if (hex === null) unfixed.push({ token: 'tok-binder', rule: 'binder' })
    else v['tok-binder'] = hex
  }
  const moved = COLOUR_TOKENS.filter((t) => v[t] !== imported[t]).map((t) => ({
    token: t,
    from: imported[t],
    to: v[t],
  }))
  return { tokens: v, moved, unfixed }
}
