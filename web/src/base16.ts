import { relativeLuminance } from './contrast'
import { COLOUR_TOKENS, type ColourToken, type Variant } from './palettes'

/**
 * A published base16 colour scheme, read from the YAML its authors publish (Plan 7 part 6b spec §4), and mapped
 * onto the palette's tokens (§5.1).
 *
 * **NO YAML LIBRARY, AND THE READER SAYS WHAT IT READS.** tinted-theming's styling guide and builder spec define two
 * layouts: the legacy one, with `scheme` and `base00`–`base0F` at the top level, and the current one, with `name`,
 * `variant` and the colours under `palette:`. Both are flat `key: value` lines, and the reader is a line reader for
 * that shape: every `base00`–`base0F` line at any indentation, and `name`, `scheme` and `variant` at none. What it
 * does not read — flow mappings, anchors and aliases, several documents, quoted keys, a block scalar as a colour —
 * none of the published files the spec surveyed uses for a colour, and each reads as an error rather than as a
 * wrong colour.
 */

/** The sixteen colours of a base16 scheme, in the styling guide's order. */
export const BASE16_KEYS = [
  'base00',
  'base01',
  'base02',
  'base03',
  'base04',
  'base05',
  'base06',
  'base07',
  'base08',
  'base09',
  'base0A',
  'base0B',
  'base0C',
  'base0D',
  'base0E',
  'base0F',
] as const

export type Base16Key = (typeof BASE16_KEYS)[number]

/** Which half of a palette a scheme fills: its own appearance. */
export type SchemeVariant = 'light' | 'dark'

export type Scheme = {
  /** `''` when the scheme names none; shown as `untitled`. */
  readonly name: string
  /** Each of the sixteen as lowercase `#rrggbb`, the one form `contrast.ts` and the pre-paint cache accept. */
  readonly colours: Readonly<Record<Base16Key, string>>
  readonly variant: SchemeVariant
  /** Whether `variant:` said so, or the colours' luminance did (spec §4.4). */
  readonly variantFrom: 'file' | 'detected'
  /** Whether it carried any of base24's `base10`–`base17`, which are read past and not used. */
  readonly base24: boolean
}

export type SchemeReading =
  | { readonly ok: true; readonly scheme: Scheme }
  | { readonly ok: false; readonly errors: readonly string[] }

/**
 * A YAML scalar's text: double-quoted with `\"` and `\\` unescaped, single-quoted with `''` read as `'`, or bare, up
 * to the first `#` that follows whitespace. Anything after a closing quote is ignored.
 */
function scalar(rest: string): string {
  const s = rest.trimStart()
  if (s.startsWith('"')) {
    let out = ''
    for (let i = 1; i < s.length; i++) {
      const c = s[i]
      if (c === '\\' && (s[i + 1] === '"' || s[i + 1] === '\\')) {
        out += s[++i]
        continue
      }
      if (c === '"') return out
      out += c
    }
    return out
  }
  if (s.startsWith("'")) {
    let out = ''
    for (let i = 1; i < s.length; i++) {
      if (s[i] === "'" && s[i + 1] === "'") {
        out += "'"
        i++
        continue
      }
      if (s[i] === "'") return out
      out += s[i]
    }
    return out
  }
  const cut = /\s#/.exec(s)
  return (cut === null ? s : s.slice(0, cut.index)).trim()
}

/**
 * Read a scheme, or say everything that is wrong with the text, each error naming its key.
 *
 * **A BARE `#rrggbb` IS A COLOUR HERE, WHERE YAML READS AN EMPTY VALUE AND A COMMENT** (spec §3 row 12): no one
 * writing `base00: #1d2021` means a comment, and none of the published files writes one, so the difference never
 * changes how a published scheme reads.
 */
export function readScheme(text: string): SchemeReading {
  const raw = new Map<Base16Key, string>()
  const errors: string[] = []
  const top = new Map<string, string>()
  let base24 = false
  for (const line of text.split(/\r?\n/)) {
    const m = /^([ \t]*)([A-Za-z0-9_]+)[ \t]*:(.*)$/.exec(line)
    if (m === null) continue
    const indent = m[1] ?? ''
    const key = m[2] ?? ''
    const rest = m[3] ?? ''
    const colour = /^base0([0-9a-fA-F])$/.exec(key)
    if (colour !== null) {
      const k = `base0${(colour[1] ?? '').toUpperCase()}` as Base16Key
      if (raw.has(k)) errors.push(`${k} is given twice`)
      else raw.set(k, scalar(rest))
      continue
    }
    if (/^base1[0-7]$/.test(key)) {
      base24 = true
      continue
    }
    if (indent === '' && (key === 'name' || key === 'scheme' || key === 'variant') && !top.has(key)) {
      top.set(key, scalar(rest))
    }
  }
  if (raw.size === 0) return { ok: false, errors: ['no base16 colours found'] }
  const colours: Partial<Record<Base16Key, string>> = {}
  for (const k of BASE16_KEYS) {
    const value = raw.get(k)
    if (value === undefined) {
      errors.push(`${k} is missing`)
      continue
    }
    const hex = /^#?([0-9a-fA-F]{6})$/.exec(value)
    if (hex === null) errors.push(`${k} is not a colour: ${JSON.stringify(value)}`)
    else colours[k] = `#${(hex[1] ?? '').toLowerCase()}`
  }
  if (errors.length > 0) return { ok: false, errors }
  const full = colours as Record<Base16Key, string>
  const stated = top.get('variant')?.toLowerCase()
  const fromFile = stated === 'light' || stated === 'dark'
  return {
    ok: true,
    scheme: {
      name: top.get('name') ?? top.get('scheme') ?? '',
      colours: full,
      variant: fromFile ? stated : detectVariant(full),
      variantFrom: fromFile ? 'file' : 'detected',
      base24,
    },
  }
}

/**
 * The half a scheme fills when its file does not say: dark when its default background, base00, is darker than its
 * default foreground, base05, by relative luminance (spec §4.4). It agrees with every stated variant the spec
 * measured but one, whose base00 is a bright pink under `variant: light`.
 */
export function detectVariant(colours: Readonly<Record<Base16Key, string>>): SchemeVariant {
  return relativeLuminance(colours.base00) < relativeLuminance(colours.base05) ? 'dark' : 'light'
}

/**
 * Which scheme colour each token takes (spec §5.1). It mirrors how the built-ins reuse colours — `tok-ident` and
 * `focus-ring` are `fg`, `tok-neutral` is `fg-dim`, `accent` is `tok-keyword`, `tok-nat` is `tok-bool` — and follows
 * the styling guide's roles: base00 the default background, base01 the lighter one status bars use, base02 the
 * selection, base04 and base05 the dark and default foregrounds, base08 red, base09 orange for numbers and booleans,
 * base0A yellow, base0B green, base0C cyan, base0E magenta for keywords. base03, base06, base07, base0D and base0F
 * are not used.
 */
export const BASE16_MAPPING: Readonly<Record<ColourToken, Base16Key>> = {
  bg: 'base00',
  'on-accent': 'base00',
  'bg-raised': 'base01',
  'bg-chrome': 'base01',
  rule: 'base02',
  'fg-dim': 'base04',
  'tok-neutral': 'base04',
  'tok-punct': 'base04',
  fg: 'base05',
  'tok-ident': 'base05',
  'focus-ring': 'base05',
  error: 'base08',
  'tok-nat': 'base09',
  'tok-bool': 'base09',
  warn: 'base0A',
  'tok-binder': 'base0B',
  'tok-operator': 'base0C',
  accent: 'base0E',
  'tok-keyword': 'base0E',
}

/** A scheme's colours as a palette variant, every token from `BASE16_MAPPING`. */
export function mapScheme(colours: Readonly<Record<Base16Key, string>>): Variant {
  return Object.fromEntries(COLOUR_TOKENS.map((t) => [t, colours[BASE16_MAPPING[t]]])) as Record<ColourToken, string>
}

/** A scheme's name as the app shows it: `untitled` when it names none. */
export function schemeName(name: string): string {
  return name === '' ? 'untitled' : name
}
