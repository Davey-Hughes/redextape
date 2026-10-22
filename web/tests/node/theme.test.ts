import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tokenClassName } from '../../src/theme'
import { TOKEN_CLASSES } from '../../src/types'

const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8')

describe('token classes', () => {
  // NOT `toHaveLength(14)`. A hardcoded count is a second registry: add a fifteenth variant to the
  // Rust enum and the count stays at 14, agreeing with nothing real. `types.ts`'s pin holds this array
  // to the generated `TokenClass` union in both directions, which is the completeness a count only
  // pretends to.
  it('lists no token class twice, and at least one', () => {
    expect(new Set(TOKEN_CLASSES).size).toBe(TOKEN_CLASSES.length)
    expect(TOKEN_CLASSES.length).toBeGreaterThan(0)
  })

  it('lower-cases the variant name', () => {
    expect(tokenClassName('Keyword')).toBe('tok-keyword')
    expect(tokenClassName('TapeSymbol')).toBe('tok-tapesymbol')
  })

  // An unstyled span is invisible rather than loud, so the absence of a rule is exactly the kind of gap
  // that would ship unnoticed — assert it instead.
  it('defines a CSS rule for every class', () => {
    const missing = TOKEN_CLASSES.filter((c) => !css.includes(`.${tokenClassName(c)}`))
    expect(missing).toEqual([])
  })

  // `style.css` styles both schemes with `light-dark()` values resolved against `color-scheme` (the
  // `color-scheme` comment inside its `:root`), and no `prefers-color-scheme` block holds a second copy
  // of the dark values, so `light-dark(` is what this looks for.
  it('styles both colour schemes', () => {
    expect(css).toContain('light-dark(')
  })
})
