import { mapScheme, type Scheme } from '../../src/base16'
import { checkScheme } from '../../src/base16-check'
import type { CustomHalf } from '../../src/custom-palette'

/**
 * base16 schemes written for these tests (Plan 7 part 6b spec §13): no published scheme, and no licence, enters the
 * repo. Each is its sixteen colours, base00 first; `currentLayout` and `legacyLayout` write one out as the YAML the
 * two published layouts use. What each one measures is asserted where it is used, not here.
 */

/** Passes every floor and the binder rule, as it is. Dark. */
export const NIGHT = [
  '#1f1d2b',
  '#2b2838',
  '#3a3649',
  '#5b5670',
  '#9a94b0',
  '#c8c3d8',
  '#e0dcea',
  '#f2f0f7',
  '#e8707a',
  '#e0a070',
  '#e8c878',
  '#90d090',
  '#70c8c8',
  '#80a8e8',
  '#c898e0',
  '#d0a080',
] as const

/** Passes every floor and the binder rule, as it is. Light. */
export const DAY = [
  '#f6f4ee',
  '#ebe7de',
  '#ddd7ca',
  '#a8a090',
  '#5e584c',
  '#2e2a24',
  '#1e1b17',
  '#12100d',
  '#b02a30',
  '#9a4a10',
  '#7a5a00',
  '#2e6e2e',
  '#1a6a70',
  '#2a5aa0',
  '#8a3a90',
  '#7a4a30',
] as const

/** Fails 17 of the 35 floors, on base00 and base01, and every one is fixed by moving four colours' lightness. Dark. */
export const EMBER = [
  '#1c1a22',
  '#2c2833',
  '#3a3544',
  '#57506a',
  '#7e7590',
  '#8a829a',
  '#d8d0e2',
  '#f0ecf4',
  '#c06070',
  '#d09a70',
  '#d8b870',
  '#88c088',
  '#70c0c0',
  '#80a0e0',
  '#9070a0',
  '#c09070',
] as const

/** Its base01 is a bright green rather than a second background, so no text colour meets 4.5 on it and on base00. */
export const NEON = [
  '#121216',
  '#88e040',
  '#3a3a44',
  '#5a5a66',
  '#c0c0cc',
  '#e0e0ea',
  '#f0f0f6',
  '#ffffff',
  '#f07080',
  '#f0a070',
  '#f0d070',
  '#90e090',
  '#70e0e0',
  '#80b0f0',
  '#d0a0f0',
  '#d0a080',
] as const

/** `NIGHT` with its binder, base0B, 16 from its operators, base0C, in the blue channel. */
export const TWINS = NIGHT.map((c, i) => (i === 11 ? '#78c8b8' : c))

/**
 * `NIGHT` with its operators, base0C, a dark green that fails its floors, and its binder, base0B, a green that clashes
 * with nothing imported: the operators move up to pass, and end 13 from the binder in every channel.
 */
export const CLOSING = NIGHT.map((c, i) => (i === 11 ? '#78a878' : i === 12 ? '#406840' : c))

/**
 * `NIGHT` on black, with a light grey, `#aaaaaa`, for panels: its warnings and its focus ring meet 3:1 on both only in
 * a band of lightness 0.0005 wide, narrower than one step of `apply adjusted`'s walk. No text colour meets 4.5 on both.
 */
export const NARROW = NIGHT.map((c, i) => (i === 0 ? '#000000' : i === 1 ? '#aaaaaa' : c))

/**
 * Black and white under every foreground but the binder in one dark grey, `#202020`, and the binder in `#767676`,
 * which meets 4.5 on both and stands apart from everything imported. Every other text colour moves into the one band
 * of greys that meets 4.5 on both, beside the binder, and no lightness of it both passes and stands apart from them.
 */
export const BOXED = [
  '#000000',
  '#ffffff',
  '#ffffff',
  ...Array.from({ length: 8 }, () => '#202020'),
  '#767676',
  ...Array.from({ length: 4 }, () => '#202020'),
]

/**
 * Black and white under every foreground's one grey, `#767676`: the only text colours meeting 4.5 on both sit within
 * a hair of it, so its binder, drawn in the same grey, can be moved nowhere that is both legible and apart.
 */
export const STUCK = ['#000000', '#ffffff', ...Array.from({ length: 14 }, () => '#767676')]

const KEYS = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '0A', '0B', '0C', '0D', '0E', '0F']

/** A scheme in the current layout: `system`, `name`, `variant` if given, and each colour quoted, with `#`, under `palette:`. */
export function currentLayout(name: string, colours: readonly string[], variant?: string): string {
  return [
    'system: "base16"',
    `name: "${name}"`,
    'author: "redextape tests"',
    ...(variant === undefined ? [] : [`variant: "${variant}"`]),
    'palette:',
    ...KEYS.map((k, i) => `  base${k}: "${colours[i]}"`),
    '',
  ].join('\n')
}

/** A scheme in the legacy layout: `scheme`, `author`, and each colour at the top level as bare hex, quoted. */
export function legacyLayout(name: string, colours: readonly string[]): string {
  return [
    `scheme: "${name}"`,
    'author: "redextape tests"',
    ...KEYS.map((k, i) => `base${k}: "${(colours[i] ?? '').slice(1)}"`),
    '',
  ].join('\n')
}

/** `colours` as the record `readScheme` returns, keyed `base00`–`base0F`. */
export function keyed(colours: readonly string[]): Record<string, string> {
  return Object.fromEntries(KEYS.map((k, i) => [`base${k}`, colours[i] ?? '']))
}

/** A stored half, as `apply` writes one: the scheme's own colours, mapped, not adjusted. */
export function storedHalf(name: string, colours: readonly string[]): CustomHalf {
  const own = keyed(colours) as Scheme['colours']
  return { name, colours: own, tokens: mapScheme(own), adjusted: false }
}

/** A stored half, as `apply adjusted` writes one: the scheme's own colours, and the tokens the adjustment gives. */
export function adjustedHalf(name: string, colours: readonly string[], variant: 'light' | 'dark'): CustomHalf {
  const own = keyed(colours) as Scheme['colours']
  const check = checkScheme({ name, colours: own, variant, variantFrom: 'file', base24: false })
  return { name, colours: own, tokens: check.adjustment.tokens, adjusted: true }
}
