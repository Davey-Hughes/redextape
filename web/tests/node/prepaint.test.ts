import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PALETTE_CSS_PATTERN, PALETTES, paletteDeclarations } from '../../src/palettes'
import { PALETTE_CSS_KEY, STYLE_IDS, STYLE_KEY } from '../../src/skin'

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

  // The script cannot import, so it carries its own copies. These hold each copy to its source.
  it('carries the keys, the style ids and the cache pattern that skin.ts and palettes.ts define', () => {
    expect(script).toContain(`'${STYLE_KEY}'`)
    expect(script).toContain(`'${PALETTE_CSS_KEY}'`)
    for (const s of STYLE_IDS) expect(script).toContain(`'${s}'`)
    expect(script).toContain(`/${PALETTE_CSS_PATTERN.source}/`)
  })
})
