import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PALETTE_CSS_PATTERN, PALETTES, paletteDeclarations } from '../../src/palettes'
import { PALETTE_CSS_KEY, resolvePalette, STYLE_IDS, STYLE_KEY } from '../../src/skin'
import { DAY, NEON, storedHalf } from './base16-fixtures'

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')
// The one classic script in the page — the module script has a `type`.
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''

/**
 * Run the inline script against a fake `localStorage` and `<html>`, and return what it set.
 *
 * The script is a classic script in `<head>`, so the HTML standard runs it before the page's module
 * script and before first paint; what this test checks is what it DOES when it runs.
 */
function run(store: Record<string, string>, throws = false): Map<string, string> {
  const attrs = new Map<string, string>()
  const documentElement = {
    setAttribute: (k: string, v: string) => {
      attrs.set(k, v)
    },
  }
  const localStorage = {
    getItem: (k: string) => {
      if (throws) throw new Error('storage is disabled')
      return store[k] ?? null
    },
  }
  new Function('localStorage', 'document', script)(localStorage, { documentElement })
  return attrs
}

describe('the pre-paint script', () => {
  it('exists', () => {
    expect(script).not.toBe('')
  })

  it('applies a stored style and a cached palette before first paint', () => {
    const css = paletteDeclarations(PALETTES.paper)
    const attrs = run({ [STYLE_KEY]: 'paper', [PALETTE_CSS_KEY]: css })
    expect(attrs.get('data-style')).toBe('paper')
    expect(attrs.get('style')).toBe(css)
  })

  // The cache holds resolved declarations whatever produced them (Plan 7 part 6b spec §9), so an imported palette
  // reaches first paint through the same key and the same pattern, the script unchanged.
  it('applies a cached custom palette as it applies a built-in one', () => {
    const css = paletteDeclarations(
      resolvePalette('paper', 'custom', { light: storedHalf('Day', DAY), dark: storedHalf('Neon', NEON) }),
    )
    expect(PALETTE_CSS_PATTERN.test(css)).toBe(true)
    expect(run({ [PALETTE_CSS_KEY]: css }).get('style')).toBe(css)
  })

  it('still applies a stored appearance', () => {
    expect(run({ 'redextape.appearance': 'dark' }).get('data-theme')).toBe('dark')
  })

  it('ignores an unknown style and a cache that is not palette declarations', () => {
    const attrs = run({ [STYLE_KEY]: 'neon', [PALETTE_CSS_KEY]: 'color: red; background: url(x)' })
    expect(attrs.has('data-style')).toBe(false)
    expect(attrs.has('style')).toBe(false)
  })

  it('does not throw when storage does', () => {
    expect(() => run({}, true)).not.toThrow()
  })

  /**
   * **WHERE READING `localStorage` ITSELF THROWS**, as Chrome's does when this site's data is blocked. The
   * case above hands the script a store whose `getItem` throws, and a read of the name outside every `try`
   * would still pass it. Here the script finds `localStorage` where the page's own script does, as a
   * global, and the global's getter refuses.
   */
  it('does not throw when reading storage itself does', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    let reached = 0
    Object.defineProperty(globalThis, 'localStorage', {
      get: () => {
        reached += 1
        throw new DOMException('Access is denied for this document.', 'SecurityError')
      },
      configurable: true,
    })
    try {
      const attrs = new Map<string, string>()
      const documentElement = { setAttribute: (k: string, v: string) => attrs.set(k, v) }
      expect(() => new Function('document', script)({ documentElement })).not.toThrow()
      expect(reached, 'precondition: the script never read the global').toBeGreaterThan(0)
      expect(attrs.size).toBe(0)
    } finally {
      if (saved === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
      else Object.defineProperty(globalThis, 'localStorage', saved)
    }
  })

  // The script cannot import, so it carries its own copies. These hold each copy to its source.
  it('carries the keys, the style ids and the cache pattern that skin.ts and palettes.ts define', () => {
    expect(script).toContain(`'${STYLE_KEY}'`)
    expect(script).toContain(`'${PALETTE_CSS_KEY}'`)
    for (const s of STYLE_IDS) expect(script).toContain(`'${s}'`)
    expect(script).toContain(`/${PALETTE_CSS_PATTERN.source}/`)
  })
})
