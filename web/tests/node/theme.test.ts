import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tokenClassName } from '../../src/theme'
import { TOKEN_CLASSES } from '../../src/types'

const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8')

describe('token classes', () => {
  // NOT `toHaveLength(14)`. A hardcoded count is a second registry: add a fifteenth variant to the
  // Rust enum and both the list and the count stay at 14, agreeing with each other and with nothing
  // real. The union is DERIVED from this array (see `types.ts`), so the compiler enforces that every
  // name the rest of the app can use appears here — which is the completeness a count only pretends to.
  it('is the source the TokenClass union is derived from', () => {
    expect(new Set(TOKEN_CLASSES).size).toBe(TOKEN_CLASSES.length)
    expect(TOKEN_CLASSES.length).toBeGreaterThan(0)
  })

  it('lower-cases the variant name', () => {
    expect(tokenClassName('Keyword')).toBe('tok-keyword')
    expect(tokenClassName('TapeSymbol')).toBe('tok-tapesymbol')
  })

  // A future λ pane will emit Binder and Comment. An unstyled span is invisible rather than loud, so
  // the absence of a rule is exactly the kind of gap that would ship unnoticed — assert it instead.
  it('defines a CSS rule for every class', () => {
    const missing = TOKEN_CLASSES.filter((c) => !css.includes(`.${tokenClassName(c)}`))
    expect(missing).toEqual([])
  })

  // Was `expect(css).toContain('prefers-color-scheme: dark')` — true under the old mechanism, a
  // `@media (prefers-color-scheme: dark) { :root { ... } }` block duplicating every token's dark
  // value. The theme-toggle refactor (`style.css`'s header comment) replaced that with one
  // `light-dark()` call per token against `color-scheme`, so both schemes are still styled — the
  // duplication this checks for is exactly what got removed, on purpose.
  it('styles both colour schemes', () => {
    expect(css).toContain('light-dark(')
  })
})
