import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { STORAGE_KEY } from '../../src/appearance'
import { PALETTE_CSS_PATTERN, PALETTES, paletteDeclarations } from '../../src/palettes'
import { inlinePrepaint, PREPAINT, PREPAINT_SLOT } from '../../src/prepaint'
import { PALETTE_CSS_KEY, resolvePalette, STYLE_IDS, STYLE_KEY } from '../../src/skin'
import { DAY, NEON, storedHalf } from './base16-fixtures'

const script = PREPAINT
const WEB = fileURLToPath(new URL('../../', import.meta.url))
const page = (name: string): string => readFileSync(`${WEB}${name}`, 'utf8')

/**
 * Every HTML file beside `index.html` — the app and the four pages beside it (about pages design §4) — read from the
 * directory rather than listed, so a sixth page is held to the script without anyone remembering to add it here.
 * `the build` below holds this list equal to the build's inputs.
 */
const PAGES = readdirSync(WEB)
  .filter((f) => f.endsWith('.html'))
  .sort()

/** A classic script: any `<script` that is not `type="module"`. */
const CLASSIC_SCRIPT = /<script(?![^>]*\btype="module")[^>]*>/

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
    expect(run({ [STORAGE_KEY]: 'dark' }).get('data-theme')).toBe('dark')
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

  /**
   * **EVERY PAGE PAINTS IN THE STORED THEME**, and from one copy of the script: each carries the slot once, in its
   * `<head>`, and carries no inline script of its own that could be a second, drifting copy.
   */
  it.each(PAGES)('is inlined into %s, which carries the slot once in its head and no other classic script', (name) => {
    const html = page(name)
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? ''
    expect(head.split(PREPAINT_SLOT).length - 1).toBe(1)
    expect(html.split(PREPAINT_SLOT).length - 1).toBe(1)
    expect(html).not.toMatch(CLASSIC_SCRIPT)
    expect(inlinePrepaint(html)).toContain(`<script>${PREPAINT}</script>`)
    expect(inlinePrepaint(html)).not.toContain(PREPAINT_SLOT)
  })

  it('leaves a page without the slot as it is', () => {
    expect(inlinePrepaint('<head></head>')).toBe('<head></head>')
  })

  // The script cannot import, so it carries its own copies. These hold each copy to its source.
  it('carries the keys, the style ids and the cache pattern that appearance.ts, skin.ts and palettes.ts define', () => {
    expect(script).toContain(`'${STORAGE_KEY}'`)
    expect(script).toContain(`'${STYLE_KEY}'`)
    expect(script).toContain(`'${PALETTE_CSS_KEY}'`)
    for (const s of STYLE_IDS) expect(script).toContain(`'${s}'`)
    expect(script).toContain(`/${PALETTE_CSS_PATTERN.source}/`)
  })
})

/**
 * **THE BUILD INLINES IT, NOT ONLY THE FUNCTION**: each page run through the configured server — `vite.config.ts` as
 * the dev server and the build load it — comes out with the script in place of its slot. Without this, deleting the
 * plugin from the config left every case above green while every page shipped without the script.
 */
describe('the build', () => {
  let server: ViteDevServer
  beforeAll(async () => {
    server = await createServer({
      root: WEB,
      configFile: `${WEB}vite.config.ts`,
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    })
  })
  afterAll(async () => {
    await server.close()
  })

  it('takes every page as an input, and no other', () => {
    const input = server.config.build.rolldownOptions.input as Record<string, string>
    expect(
      Object.values(input)
        .map((path) => path.slice(WEB.length))
        .sort(),
    ).toEqual(PAGES)
  })

  it.each(PAGES)('serves %s with the script in place of its slot', async (name) => {
    const out = await server.transformIndexHtml(`/${name}`, page(name))
    expect(out).toContain(`<script>${PREPAINT}</script>`)
    expect(out).not.toContain(PREPAINT_SLOT)
  })
})
