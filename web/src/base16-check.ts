import { BASE16_KEYS, BASE16_MAPPING, type Base16Key, mapScheme, type Scheme, schemeName } from './base16'
import { type Adjustment, adjustVariant } from './base16-adjust'
import { BINDER_APART, type BinderClash, binderClashes, CONTRAST_FLOORS, contrastRatio } from './contrast'
import { COLOUR_TOKENS, type ColourToken, type Variant } from './palettes'

/**
 * THE CHECK (Plan 7 part 6b spec §5.3): a mapped scheme held to the floors and the binder rule the built-ins meet,
 * with what `apply adjusted` would do, and each thing the dialog says of it — the summary, the adjustment's line, the
 * failures grouped by scheme colour, and the colours an adjustment moved — in words. `base16.ts` reads and maps a
 * scheme; this says how it measures.
 */

/** A floor a mapped scheme misses: the pair, the floor, and the ratio it reaches. */
export type FloorFailure = {
  readonly fg: ColourToken
  readonly bg: ColourToken
  readonly floor: number
  readonly ratio: number
}

/** A scheme held to the floors and the binder rule, as it is and as `apply adjusted` would leave it (spec §5.3). */
export type SchemeCheck = {
  readonly scheme: Scheme
  /** The scheme mapped as it is: what `apply` applies. */
  readonly tokens: Variant
  readonly failures: readonly FloorFailure[]
  readonly clashes: readonly BinderClash[]
  /** What `apply adjusted` applies, and what it moved or could not fix. */
  readonly adjustment: Adjustment
  /** What still fails after the adjustment. */
  readonly remaining: readonly FloorFailure[]
  readonly remainingClashes: readonly BinderClash[]
}

function floorFailures(v: Variant): FloorFailure[] {
  return CONTRAST_FLOORS.map(([fg, bg, floor]) => ({ fg, bg, floor, ratio: contrastRatio(v[fg], v[bg]) })).filter(
    (f) => f.ratio < f.floor,
  )
}

/**
 * Map a scheme, hold it to the floors and the binder rule `contrast.ts` holds the built-ins to, and adjust it, so the
 * dialog can say both what the scheme fails and what `apply adjusted` would do about it.
 */
export function checkScheme(scheme: Scheme): SchemeCheck {
  const tokens = mapScheme(scheme.colours)
  const adjustment = adjustVariant(tokens)
  return {
    scheme,
    tokens,
    failures: floorFailures(tokens),
    clashes: binderClashes(tokens),
    adjustment,
    remaining: floorFailures(adjustment.tokens),
    remainingClashes: binderClashes(adjustment.tokens),
  }
}

/** Whether the scheme meets every floor and the binder rule as it is, which leaves `apply adjusted` nothing to do. */
export function passes(check: SchemeCheck): boolean {
  return check.failures.length === 0 && check.clashes.length === 0
}

/**
 * Each token in words (spec §5.3): what it colours as a foreground, and, for the four a foreground sits on, what that
 * surface is. `accent` is both, and reads the same either way.
 */
const WORDS: Readonly<Record<ColourToken, string>> = {
  bg: 'the page',
  'bg-raised': 'panels',
  'bg-chrome': 'headers',
  rule: 'rules',
  fg: 'text',
  'fg-dim': 'dim text',
  accent: 'accents',
  'on-accent': 'text on accents',
  'focus-ring': 'the focus ring',
  error: 'error text',
  warn: 'warnings',
  'tok-neutral': 'plain code',
  'tok-keyword': 'keywords',
  'tok-ident': 'names',
  'tok-nat': 'numbers',
  'tok-bool': 'booleans',
  'tok-operator': 'operators',
  'tok-punct': 'punctuation',
  'tok-binder': 'binders',
}

/** `a`, `a and b`, `a, b and c`, each once, in the order given. */
function list(items: readonly string[]): string {
  const once = [...new Set(items)]
  return once.length < 2 ? (once[0] ?? '') : `${once.slice(0, -1).join(', ')} and ${once.at(-1)}`
}

/** `n` and its noun, singular for one. */
const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/** A ratio as the check prints it: cut, not rounded, to two places, so a ratio below its floor never prints as it. */
const ratio = (r: number): string => (Math.floor(r * 100) / 100).toFixed(2)

/** How many scheme colours, other than the binder's own, the clashing tokens take. */
const clashColours = (clashes: readonly BinderClash[]): number =>
  new Set(clashes.map((c) => BASE16_MAPPING[c.token])).size

/**
 * The summary (spec §5.3, 1): the scheme's name, its variant and how it was found, and how it measures — `Ember ·
 * dark, detected: 17 of 35 contrast checks below WCAG AA, worst 3.31:1`. A base24 scheme adds a second line.
 */
export function summaryLines(check: SchemeCheck): string[] {
  const { scheme, failures, clashes } = check
  const head = `${schemeName(scheme.name)} · ${scheme.variant}, ${scheme.variantFrom === 'file' ? 'from the file' : 'detected'}`
  const floors =
    failures.length === 0
      ? 'every contrast check passes'
      : `${failures.length} of ${CONTRAST_FLOORS.length} contrast checks below WCAG AA, worst ${ratio(Math.min(...failures.map((f) => f.ratio)))}:1`
  const binder = clashes.length === 0 ? '' : `; binders too close to ${count(clashColours(clashes), 'other colour')}`
  const lines = [`${head}: ${floors}${binder}`]
  if (scheme.base24) lines.push('base24: its eight extra colours, base10–base17, are not used')
  return lines
}

/** Where a token's floors sit, as scheme colours: `on base01`, `on both base00 and base01`. */
function surfacesOf(t: ColourToken): string {
  const keys = [...new Set(CONTRAST_FLOORS.filter(([fg]) => fg === t).map(([, bg]) => BASE16_MAPPING[bg]))]
  return keys.length === 2 ? `on both ${keys[0]} and ${keys[1]}` : `on ${list(keys)}`
}

/**
 * What `apply adjusted` does, in one line (spec §5.3, 2), or `null` when the scheme passes and it has nothing to do.
 * Its count is the number of lines `movedColours` gives, the `changes` the details list.
 */
export function adjustLine(check: SchemeCheck): string | null {
  if (passes(check)) return null
  const n = movedColours(check.scheme.colours, check.adjustment.tokens).length
  const moves = `apply adjusted moves ${n === 0 ? 'no colour’s' : n === 1 ? '1 colour’s' : `${n} colours’`} lightness`
  const { remaining, remainingClashes, adjustment } = check
  if (remaining.length === 0 && remainingClashes.length === 0) return `${moves}, and every check then passes`
  const left: string[] = []
  if (remaining.length > 0) {
    const where = new Set(adjustment.unfixed.filter((u) => u.rule === 'floors').map((u) => surfacesOf(u.token)))
    left.push(
      `${count(remaining.length, 'check')} still fail${remaining.length === 1 ? 's' : ''}, where no lightness passes ${[...where].join(' or ')}`,
    )
  }
  if (remainingClashes.length > 0) {
    left.push(
      `binders stay too close to ${count(clashColours(remainingClashes), 'other colour')}, where no lightness sets them apart`,
    )
  }
  return `${moves}; ${left.join('; ')}`
}

/**
 * What the scheme fails, grouped by scheme colour pair (spec §5.3, 3) — `base08 on base01: error text on panels and
 * headers — 3.53:1, needs 4.5` — the pair furthest below its floor first; then each colour the binder sits too close
 * to. The tokens of one pair are one pair of colours, so a group has one ratio, and its floor is the highest it fails.
 */
export function failureLines(check: SchemeCheck): string[] {
  const groups = new Map<string, FloorFailure[]>()
  for (const f of check.failures) {
    const pair = `${BASE16_MAPPING[f.fg]} on ${BASE16_MAPPING[f.bg]}`
    groups.set(pair, [...(groups.get(pair) ?? []), f])
  }
  const floors = [...groups]
    .map(([pair, fs]) => {
      const floor = Math.max(...fs.map((f) => f.floor))
      const r = fs[0]?.ratio ?? 0
      const on = list(fs.map((f) => WORDS[f.bg]))
      const said = list(COLOUR_TOKENS.filter((t) => fs.some((f) => f.fg === t)).map((t) => WORDS[t]))
      const what = said.endsWith(` on ${on}`) ? said : `${said} on ${on}`
      return { line: `${pair}: ${what} — ${ratio(r)}:1, needs ${floor}`, below: r / floor }
    })
    .sort((a, b) => a.below - b.below)
    .map((g) => g.line)
  const binders = BASE16_KEYS.flatMap((key) => {
    const near = check.clashes.filter((c) => BASE16_MAPPING[c.token] === key)
    if (near.length === 0) return []
    const words = list(near.map((c) => WORDS[c.token]))
    const apart = Math.min(...near.map((c) => c.apart))
    return [
      `${BASE16_MAPPING['tok-binder']} beside ${key}: binders too close to ${words} — ${apart} apart, needs ${BINDER_APART}`,
    ]
  })
  return [...floors, ...binders]
}

/** One scheme colour the adjustment moved, to one value, and the tokens that took it. */
export type MovedColour = {
  readonly key: Base16Key
  readonly from: string
  readonly to: string
  readonly tokens: readonly ColourToken[]
}

/**
 * What an adjustment changed, read off a scheme's own colours and the tokens applied (spec §8.4): one entry per
 * scheme colour and value it moved to, so tokens that share a colour and ended equal are one line, and tokens that
 * share one and ended apart are two. A token `tokens` lacks, or holds unmoved, is not a change.
 */
export function movedColours(
  colours: Readonly<Record<Base16Key, string>>,
  tokens: Readonly<Partial<Record<ColourToken, string>>>,
): MovedColour[] {
  const moved: MovedColour[] = []
  for (const key of BASE16_KEYS) {
    const to = new Map<string, ColourToken[]>()
    for (const t of COLOUR_TOKENS) {
      const value = tokens[t]
      if (BASE16_MAPPING[t] !== key || value === undefined || value === colours[key]) continue
      to.set(value, [...(to.get(value) ?? []), t])
    }
    for (const [value, ts] of to) moved.push({ key, from: colours[key], to: value, tokens: ts })
  }
  return moved
}

/** A moved colour as the details and the `changes` panel list it: `base08 #bf616a → #f59199, as error text`. */
export function movedLine(m: MovedColour): string {
  return `${m.key} ${m.from} → ${m.to}, as ${list(m.tokens.map((t) => WORDS[t]))}`
}
