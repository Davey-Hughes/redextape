import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'vite'
import { describe, expect, it } from 'vitest'
import { byCodeUnit, scanCss, scanHtml, scanTs, TOOLCHAIN, webUrl } from '../../scripts/licences'

const SRC = fileURLToPath(new URL('../../src/', import.meta.url))

/** A specifier's package, as the generator reads one. */
const packageOf = (spec: string): string =>
  spec
    .split('/')
    .slice(0, spec.startsWith('@') ? 2 : 1)
    .join('/')

/** The packages a parser finds `code` importing: static imports, re-exports and string-literal dynamic imports. */
function parsed(file: string, code: string): string[] {
  const { module } = parseSync(file, code)
  const specs = [
    ...module.staticImports.map((i) => i.moduleRequest.value),
    ...module.staticExports.flatMap((e) => e.entries.flatMap((x) => (x.moduleRequest ? [x.moduleRequest.value] : []))),
    ...module.dynamicImports.map((d) => code.slice(d.moduleRequest.start + 1, d.moduleRequest.end - 1)),
  ]
  return [...new Set(specs.filter((s) => !/^[./]/.test(s)).map(packageOf))].sort(byCodeUnit)
}

/**
 * **THE GENERATOR'S IMPORT SCAN IS A REGULAR EXPRESSION, SO IT IS HELD TO A PARSER.** For every source the app
 * ships, the packages it reads are the packages Vite's own parser finds — so a form of import the expression does not
 * know fails here rather than leaving a shipped package off the licences page.
 */
describe('the licences scan', () => {
  const sources = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts'))

  it.each(sources)('reads the packages %s imports as a parser does', (file) => {
    const code = readFileSync(join(SRC, file), 'utf8')
    expect(scanTs(code, file)).toEqual(parsed(file, code))
  })

  it('reads no import out of a comment', () => {
    expect(scanTs("// import x from 'commented'\n/* import y from 'blocked' */\nimport z from 'real'")).toEqual([
      'real',
    ])
  })

  it('refuses an import whose specifier is built in a template, which it cannot read', () => {
    expect(() => scanTs(`const m = await import(\`pkg-\${name}\`)`)).toThrow(/template/)
  })

  it('reads a stylesheet in any quotes or none, and not a data: or http URL', () => {
    const css = `@import "a/x.css"; @import 'b/y.css'; .f { src: url(c/z.woff2), url("d/w.woff2"),
      url(data:font/woff2;base64,AA), url(https://e.example/v.woff2) } /* url(commented/u.woff2) */`
    expect(scanCss(css)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('reads a page beside the app, but not its comments', () => {
    const html = `<link href="/node_modules/@scope/pkg/f.woff2"><!-- /node_modules/.pnpm/x --><a href="/node_modules/plain/x">`
    expect(scanHtml(html)).toEqual(['@scope/pkg', 'plain'])
  })

  /** Each real page's inline module scripts, held to the parser as every source is. */
  it.each(readdirSync(fileURLToPath(new URL('../../', import.meta.url))).filter((f) => f.endsWith('.html')))(
    "reads what %s's inline module scripts import as a parser does",
    (name) => {
      const html = readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8').replace(
        /<!--[\s\S]*?-->/g,
        '',
      )
      const bodies = [...html.matchAll(/<script\b[^>]*\btype="module"[^>]*>([\s\S]*?)<\/script>/g)].map(
        (m) => m[1] ?? '',
      )
      for (const body of bodies) expect(scanTs(body)).toEqual(parsed(`${name}.ts`, body))
      const nodeModules = scanHtml(html.replace(/<script\b[\s\S]*?<\/script>/g, ''))
      expect(scanHtml(html)).toEqual(
        [...new Set([...nodeModules, ...bodies.flatMap((b) => parsed(name, b))])].sort(byCodeUnit),
      )
    },
  )

  it.each([`type="module"`, `type='module'`, 'type=module'])('reads an inline script written %s', (attr) => {
    expect(scanHtml(`<script ${attr}>import { a } from 'inline-pkg'</script>`)).toEqual(['inline-pkg'])
  })

  it("reads what a page's inline module script imports, and not its own sources", () => {
    const html = `<script type="module">\n import { a } from 'inline-pkg'\n import { b } from '/src/b.ts'\n</script>`
    expect(scanHtml(html)).toEqual(['inline-pkg'])
  })
})

/**
 * **THE STANDARD LIBRARY'S CRATES THAT A BUILT `.wasm` NAMES ARE THE ONES LISTED.** A panic location keeps its source
 * path. A crate std compiles in from its own lockfile's registry leaves `/rust/deps/<crate>-<version>`, and each one
 * must be in `TOOLCHAIN`; a crate built from the Rust tree leaves `/rustc/<commit>/library/<crate>/`, and those must be
 * only `alloc`, `core` and `std`, which the Rust repository's own licence covers — so `compiler-builtins`, built from
 * that tree too, would fail here the day it panics. **WHAT NEITHER CAN SEE** is a crate that panics nowhere, from
 * either place: `compiler-builtins` is listed from the names in an unstripped build, which `pkg/` is not. Read from the
 * builds `pkg/` and `pkg-lsp/` hold, which CI's web job makes before its tests run.
 */
describe('the toolchain list', () => {
  const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
  const builds = ['pkg/redextape_wasm_bg.wasm', 'pkg-lsp/redextape_lsp_wasm_bg.wasm']
  const read = (build: string): string => readFileSync(join(ROOT, build)).toString('latin1')

  it.each(builds)('names every registry crate of the standard library %s carries', (build) => {
    const carried = [
      ...new Set([...read(build).matchAll(/\/rust\/deps\/([a-z0-9_-]+?)-\d+\.\d+\.\d+/g)].map((m) => m[1])),
    ]
    expect(carried.length, 'precondition: the build carries some').toBeGreaterThan(0)
    const listed = TOOLCHAIN.flatMap((t) => (t.crate === undefined ? [] : [t.crate]))
    for (const crate of carried) expect(listed, crate).toContain(crate)
  })

  it.each(builds)('carries no crate from the Rust tree but alloc, core and std in %s', (build) => {
    const inTree = [
      ...new Set([...read(build).matchAll(/\/rustc\/[0-9a-f]{40}\/library\/([a-z_-]+)\//g)].map((m) => m[1])),
    ]
    expect(inTree.sort()).toEqual(['alloc', 'core', 'std'])
  })
})

describe('a package link', () => {
  it.each([
    ['git+https://github.com/o/r.git', 'https://github.com/o/r'],
    ['git://github.com/o/r.git', 'https://github.com/o/r'],
    ['https://example.com/x', 'https://example.com/x'],
  ])('opens %s in a browser as %s', (raw, url) => {
    expect(webUrl(raw, 'fallback')).toBe(url)
  })

  /** A package's own field is not this site's to trust: anything a browser cannot open, or should not, falls back. */
  it.each([
    ['github: shorthand', 'github:o/r'],
    ['owner/repo shorthand', 'o/r'],
    ['an ssh URL', 'git+ssh://git@github.com/o/r.git'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['nothing', undefined],
  ])('falls back on %s', (_, raw) => {
    expect(webUrl(raw, 'https://www.npmjs.com/package/p')).toBe('https://www.npmjs.com/package/p')
  })
})

describe('the order', () => {
  /** Danish collates `aa` as `å`, after `z`; the file's bytes may not depend on the machine's locale. */
  it('is by code unit, whatever the locale would say', () => {
    expect(['zz', 'aa', 'b'].sort(byCodeUnit)).toEqual(['aa', 'b', 'zz'])
    expect(['zz', 'aa', 'b'].sort((a, b) => a.localeCompare(b, 'da'))).toEqual(['b', 'zz', 'aa'])
  })
})
