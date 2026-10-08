import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { binderClashes, CONTRAST_FLOORS, contrastRatio } from '../../src/contrast'
import {
  COLOUR_TOKENS,
  PALETTE_CSS_PATTERN,
  PALETTE_IDS,
  PALETTES,
  paletteDeclarations,
  type Variant,
} from '../../src/palettes'

const VARIANTS: [string, Variant][] = PALETTE_IDS.flatMap((id): [string, Variant][] => [
  [`${id} light`, PALETTES[id].light],
  [`${id} dark`, PALETTES[id].dark],
])

describe('palettes', () => {
  it('has one palette per id, each carrying its own id', () => {
    for (const id of PALETTE_IDS) expect(PALETTES[id].id).toBe(id)
  })

  it('writes every value as lowercase #rrggbb', () => {
    for (const [name, v] of VARIANTS) {
      for (const t of COLOUR_TOKENS) expect(v[t], `${name} ${t}`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('meets every contrast floor in every variant', () => {
    const failures: string[] = []
    for (const [name, v] of VARIANTS) {
      for (const [fg, bg, floor] of CONTRAST_FLOORS) {
        const r = contrastRatio(v[fg], v[bg])
        if (r < floor) failures.push(`${name}: ${fg} on ${bg} is ${r.toFixed(2)}, floor ${floor}`)
      }
    }
    expect(failures).toEqual([])
  })

  // The rule and why it is scoped to `tok-binder` are `contrast.ts`'s `binderClashes`, which an import is held to
  // as well.
  it('keeps tok-binder apart from every other token', () => {
    const failures: string[] = []
    for (const [name, v] of VARIANTS) {
      for (const { token, apart } of binderClashes(v)) {
        failures.push(`${name}: tok-binder ${v['tok-binder']} is ${apart} from ${token} ${v[token]}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('declares every token once, as a light-dark pair', () => {
    const css = paletteDeclarations(PALETTES.paper)
    for (const t of COLOUR_TOKENS) {
      expect(css).toContain(`--${t}: light-dark(${PALETTES.paper.light[t]}, ${PALETTES.paper.dark[t]});`)
      expect(css.split(`--${t}:`).length - 1, t).toBe(1)
    }
  })

  // The pre-paint script (`prepaint.ts`) applies a cached declaration string only if it matches this
  // pattern (Task 4); every string `paletteDeclarations` produces must therefore pass it.
  it('produces text the pre-paint script accepts', () => {
    for (const id of PALETTE_IDS) expect(PALETTE_CSS_PATTERN.test(paletteDeclarations(PALETTES[id]))).toBe(true)
  })

  it('rejects text that is not palette declarations', () => {
    for (const bad of [
      '',
      'color: red;',
      '--bg: url(x);',
      '--bg: light-dark(#fff, #000);',
      '--bg: light-dark(#ffffff, #000000); x',
    ]) {
      expect(PALETTE_CSS_PATTERN.test(bad), bad).toBe(false)
    }
  })
})

const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8')

describe('style.css against the palettes', () => {
  // The fallback is what a page shows before `main.ts` applies a palette, and on the startup-failure path
  // where it never does. It is Instrument, the first-visit default — and a second copy, so this holds
  // the two equal.
  it('holds Instrument as its fallback, token for token', () => {
    const block = /\/\* palette:fallback:begin \*\/([\s\S]*?)\/\* palette:fallback:end \*\//.exec(css)?.[1]
    expect(block, 'the fallback markers').toBeDefined()
    const found = new Map<string, string>()
    for (const m of (block ?? '').matchAll(/--([a-z0-9-]+): light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\);/g)) {
      found.set(m[1] ?? '', `${m[2]} ${m[3]}`)
    }
    const want = new Map(
      COLOUR_TOKENS.map((t) => [t, `${PALETTES.instrument.light[t]} ${PALETTES.instrument.dark[t]}`] as const),
    )
    expect(found).toEqual(want)
  })

  // One direction only, deliberately: a palette may define a token no rule reads yet (`on-accent`), but a
  // rule may not read a token nothing defines — that renders as the property's initial value, silently.
  // A `var()` with a fallback (`var(--divider-size, 4px)`) is excluded because it defines its own answer.
  it('reads no custom property that nothing defines', () => {
    const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
    for (const t of COLOUR_TOKENS) declared.add(`--${t}`)
    const read = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1])
    expect(read.filter((name) => !declared.has(name))).toEqual([])
  })
})
