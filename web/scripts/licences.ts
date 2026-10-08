/**
 * THE LICENCES THE SITE SHIPS — about pages design §8. Writes `src/third-party-licences.json`, which the licences page
 * renders: redextape's own licence, then every npm package whose code or font reaches the browser, every crate
 * compiled into the two `.wasm` builds, and the toolchains' runtimes compiled in beside them, each with the licence
 * texts its own package carries.
 *
 *     node scripts/licences.ts            # write src/third-party-licences.json
 *     node scripts/licences.ts --stdout   # print it instead (`scripts/check-licences.sh` diffs this)
 *
 * **OVER-INCLUDING IS HARMLESS AND UNDER-INCLUDING IS THE DEFECT**, so each side takes a closure rather than asking a
 * bundler what survived tree-shaking:
 *
 * - npm: every bare specifier `src/` and the pages' inline module scripts import, every package the CSS loads, and
 *   every package a page references under `/node_modules/`, walked along `dependencies` and `peerDependencies`. The
 *   specifiers are read from the sources rather than listed here, so a new import is counted without editing this
 *   file; an import this cannot read — a specifier built in a template — makes it throw, and `licences-scan.test.ts`
 *   holds the scan to Vite's parser over every source and every page's inline module scripts. `vite` and `rolldown` are added by name: Vite's preload helper and rolldown's module helpers are in
 *   the built chunk though nothing imports them; their own dependencies are their Node build's and are not walked.
 * - Rust: `cargo tree` for each wasm crate on `wasm32-unknown-unknown`, along normal edges and not into a proc-macro
 *   crate, which runs in the compiler and leaves nothing in the `.wasm`. Each build resolves its own features, so
 *   this is what each build compiles, not the workspace's feature union `cargo metadata` reports.
 * - The toolchains: the Rust standard library and the crates it compiles in beside it — its allocator, its hash map
 *   and its intrinsics — in both `.wasm` builds, and Emscripten's runtime, compiled into `web-tree-sitter`. No package
 *   manager names them, so `TOOLCHAIN` does, and their texts are committed under `scripts/toolchain-licences/` rather
 *   than read from an installed toolchain, which would change this file with every Rust release.
 *   `licences-scan.test.ts` holds `TOOLCHAIN` to the standard library's crates a built `.wasm` names.
 *
 * Every package must carry at least one file whose name holds `licence`, `license`, `copying`, `copyright` or
 * `notice`, or this throws; a link that is not `http(s)` falls back to the registry's page. The output is sorted by
 * code unit, never by locale, so it is the same bytes on every machine.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const REPO = join(WEB, '..')
const OUT = join(WEB, 'src', 'third-party-licences.json')

/** The crates whose `.wasm` the site serves. */
const WASM_CRATES = ['redextape-wasm', 'redextape-lsp-wasm']

/** Where each shipped package sits on the licences page. */
export type Group = 'code' | 'wasm' | 'toolchain' | 'font'

export type Package = {
  readonly name: string
  readonly version: string
  readonly spdx: string
  readonly group: Group
  readonly url: string
  /** Each licence file the package carries: its name, and the id of its text in `texts`. */
  readonly files: readonly { readonly file: string; readonly text: string }[]
}

/**
 * What no package manager reports: compiled in by a toolchain rather than resolved by one. Each `dir` under
 * `scripts/toolchain-licences/` holds the texts as published, at the versions that built the shipped files:
 *
 * - the Rust repository's `COPYRIGHT`, `LICENSE-MIT` and `LICENSE-APACHE`, at the commit of Rust 1.99.0
 *   (`b940084d7`);
 * - `compiler-builtins`' `LICENSE.txt`, from the same tree, where the standard library builds it from (0.1.160 in
 *   that release's `library/Cargo.lock`): both builds link its `__multi3` and `memcmp`, found by name in the
 *   unstripped `.wasm` wasm-pack builds first;
 * - `dlmalloc`'s and `hashbrown`'s licence files, from the crates that lockfile names (0.2.14 and 0.17.1): both
 *   builds carry their source paths, `/rust/deps/dlmalloc-0.2.14` and `/rust/deps/hashbrown-0.17.1`;
 * - Emscripten's `LICENSE` at 4.0.15, the version `web-tree-sitter` 0.27.0 is built with.
 *
 * No version is shown on the page: the runtimes are whatever the toolchain in use compiles in, under the same
 * licences. `crate` is the name a `/rust/deps/` path gives, for the test that holds this list to the built files.
 */
export const TOOLCHAIN: readonly { name: string; spdx: string; url: string; dir: string; crate?: string }[] = [
  {
    name: 'The Rust standard library',
    spdx: 'MIT OR Apache-2.0',
    url: 'https://github.com/rust-lang/rust',
    dir: 'rust',
  },
  {
    name: "compiler-builtins, the standard library's intrinsics",
    spdx: 'MIT AND Apache-2.0 WITH LLVM-exception AND (MIT OR Apache-2.0)',
    url: 'https://github.com/rust-lang/compiler-builtins',
    dir: 'compiler-builtins',
  },
  {
    name: "dlmalloc, the standard library's allocator",
    spdx: 'MIT OR Apache-2.0',
    url: 'https://github.com/alexcrichton/dlmalloc-rs',
    dir: 'dlmalloc',
    crate: 'dlmalloc',
  },
  {
    name: "hashbrown, the standard library's hash map",
    spdx: 'MIT OR Apache-2.0',
    url: 'https://github.com/rust-lang/hashbrown',
    dir: 'hashbrown',
    crate: 'hashbrown',
  },
  {
    name: "Emscripten's runtime, in web-tree-sitter",
    spdx: 'MIT OR NCSA',
    url: 'https://github.com/emscripten-core/emscripten',
    dir: 'emscripten',
  },
]

const LICENCE_FILE = /licen[cs]e|copying|copyright|notice/i

/** Code-unit order: a locale's collation moves `aa` in Danish and `z` in Estonian, and this file must not move. */
export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * What of a licence file is reproduced. Vite's `LICENSE.md` goes on to carry the licences of what Vite bundles into
 * its own Node build, none of which reaches a browser; only its first section is Vite's.
 */
function excerpt(name: string, text: string): string {
  if (name !== 'vite') return text
  const end = text.indexOf('\n# Licenses of bundled dependencies')
  if (end < 0) throw new Error("vite's LICENSE.md no longer has its bundled-dependencies heading; re-read it")
  return `${text.slice(0, end).trimEnd()}\n`
}

/** A link a browser can open, or `fallback`: a `git+`/`git:` URL made `https`, and anything else not `http(s)`. */
export function webUrl(raw: string | undefined | null, fallback: string): string {
  const url = (raw ?? '')
    .trim()
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
  return /^https?:\/\/[^\s"'<>]+$/.test(url) ? url : fallback
}

/** A specifier's package: `@scope/name` or `name`, without any path or query after it. */
const packageOf = (spec: string): string =>
  spec
    .split('/')
    .slice(0, spec.startsWith('@') ? 2 : 1)
    .join('/')

/** The packages one TypeScript source imports, comments blanked so prose is not read as an import. */
export function scanTs(code: string, where = 'a source'): string[] {
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  if (/\bimport\s*\(\s*`/.test(bare)) throw new Error(`${where} imports a specifier built in a template; name it`)
  const found = new Set<string>()
  for (const m of bare.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)['"]([^'"./][^'"]*)['"]/g))
    found.add(packageOf(m[1] ?? ''))
  return [...found].sort(byCodeUnit)
}

/** The packages one stylesheet loads, through `@import` or `url()`, quoted or not. */
export function scanCss(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const found = new Set<string>()
  for (const m of bare.matchAll(/(?:@import\s+|url\(\s*)["']?([^"')./\s][^"')\s]*)/g)) {
    if (!/^(data|https?):/.test(m[1] ?? '')) found.add(packageOf(m[1] ?? ''))
  }
  return [...found].sort(byCodeUnit)
}

/**
 * The packages one HTML page loads: what it references under `/node_modules/`, and what its inline module scripts
 * import, read as `scanTs` reads a source — its comments blanked as prose.
 */
export function scanHtml(html: string): string[] {
  const bare = html.replace(/<!--[\s\S]*?-->/g, '')
  const found = new Set([...bare.matchAll(/\/node_modules\/((?:@[^/"']+\/)?[^/"']+)/g)].map((m) => m[1] ?? ''))
  for (const m of bare.matchAll(/<script\b[^>]*\btype\s*=\s*["']?module\b[^>]*>([\s\S]*?)<\/script>/g)) {
    for (const p of scanTs(m[1] ?? '', 'an inline module script')) found.add(p)
  }
  return [...found].sort(byCodeUnit)
}

/** Every package `src/` and the pages beside it import or load. */
export function importedPackages(): string[] {
  const found = new Set<string>()
  for (const file of readdirSync(join(WEB, 'src'), { recursive: true }) as string[]) {
    const path = join(WEB, 'src', file)
    if (file.endsWith('.ts')) for (const p of scanTs(readFileSync(path, 'utf8'), path)) found.add(p)
    else if (file.endsWith('.css')) for (const p of scanCss(readFileSync(path, 'utf8'))) found.add(p)
  }
  for (const page of readdirSync(WEB).filter((f) => f.endsWith('.html'))) {
    for (const p of scanHtml(readFileSync(join(WEB, page), 'utf8'))) found.add(p)
  }
  return [...found].sort(byCodeUnit)
}

type Manifest = {
  name: string
  version: string
  license?: string
  homepage?: string
  repository?: string | { url?: string }
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/** The directory of `name` as `fromDir` resolves it — through `exports` when it lists `package.json`, else on disk. */
function packageDir(name: string, fromDir: string): string {
  try {
    return dirname(realpathSync(createRequire(join(fromDir, 'noop.js')).resolve(`${name}/package.json`)))
  } catch {
    for (let d = fromDir; ; d = dirname(d)) {
      try {
        return dirname(realpathSync(join(d, 'node_modules', name, 'package.json')))
      } catch {
        if (dirname(d) === d) throw new Error(`${name} does not resolve from ${fromDir}`)
      }
    }
  }
}

type Metadata = {
  packages: {
    name: string
    version: string
    license: string | null
    repository: string | null
    homepage: string | null
    source: string | null
    manifest_path: string
  }[]
}

/** The licences file's contents, generated afresh: one call, its own text store. */
export function generate(): string {
  const texts = new Map<string, string>()
  /** `text`'s id, storing it once whichever package carries it. */
  const store = (text: string): string => {
    const id = createHash('sha256').update(text).digest('hex').slice(0, 16)
    texts.set(id, text)
    return id
  }
  const licenceFiles = (name: string, dir: string): Package['files'] => {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && LICENCE_FILE.test(e.name))
      .map((e) => e.name)
      .sort(byCodeUnit)
    if (files.length === 0) throw new Error(`${name} (${dir}) carries no licence file`)
    return files.map((file) => ({ file, text: store(excerpt(name, readFileSync(join(dir, file), 'utf8'))) }))
  }

  const npm = (): Package[] => {
    const fonts = new Set(['@fontsource/inter', 'hack-font'])
    const seen = new Map<string, Package>()
    const visit = (name: string, fromDir: string, walk: boolean): string => {
      const dir = packageDir(name, fromDir)
      const m = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest
      const key = `${m.name}@${m.version}`
      if (!seen.has(key)) {
        const repo = typeof m.repository === 'string' ? m.repository : m.repository?.url
        seen.set(key, {
          name: m.name,
          version: m.version,
          spdx: m.license ?? 'SEE LICENSE',
          group: fonts.has(m.name) ? 'font' : 'code',
          url: webUrl(m.homepage ?? repo, `https://www.npmjs.com/package/${m.name}`),
          files: licenceFiles(m.name, dir),
        })
        if (walk) for (const dep of Object.keys({ ...m.dependencies, ...m.peerDependencies })) visit(dep, dir, true)
      }
      return dir
    }
    for (const name of importedPackages()) visit(name, WEB, true)
    const vite = visit('vite', WEB, false)
    visit('rolldown', vite, false)
    return [...seen.values()]
  }

  const crates = (): Package[] => {
    const cargo = (args: string[]): string =>
      execFileSync('cargo', args, {
        cwd: REPO,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'inherit'],
      })
    const meta = JSON.parse(cargo(['metadata', '--format-version', '1', '--locked'])) as Metadata
    const byKey = new Map(meta.packages.map((p) => [`${p.name} ${p.version}`, p]))
    const keys = new Set<string>()
    for (const crate of WASM_CRATES) {
      const tree = cargo([
        'tree',
        '--locked',
        '-p',
        crate,
        '--target',
        'wasm32-unknown-unknown',
        '-e',
        'normal,no-proc-macro',
        '--prefix',
        'none',
        '--format',
        '{p}',
      ])
      for (const line of tree.split('\n')) {
        const m = /^(\S+) v(\S+)/.exec(line)
        if (m !== null) keys.add(`${m[1]} ${m[2]}`)
      }
    }
    return [...keys].flatMap((key) => {
      const p = byKey.get(key)
      if (p === undefined) throw new Error(`cargo tree names ${key}, which cargo metadata does not`)
      // `source` is null for a path dependency: this workspace's own crates, which are redextape's licence.
      if (p.source === null) return []
      return [
        {
          name: p.name,
          version: p.version,
          spdx: p.license ?? 'SEE LICENSE',
          group: 'wasm' as const,
          url: webUrl(p.repository ?? p.homepage, `https://crates.io/crates/${p.name}`),
          files: licenceFiles(p.name, dirname(p.manifest_path)),
        },
      ]
    })
  }

  const toolchain = (): Package[] =>
    TOOLCHAIN.map((t) => ({
      name: t.name,
      version: '',
      spdx: t.spdx,
      group: 'toolchain' as const,
      url: t.url,
      files: licenceFiles(t.name, join(WEB, 'scripts', 'toolchain-licences', t.dir)),
    }))

  const ORDER: Record<Group, number> = { code: 0, wasm: 1, toolchain: 2, font: 3 }
  const packages = [...npm(), ...crates(), ...toolchain()].sort(
    (a, b) => ORDER[a.group] - ORDER[b.group] || byCodeUnit(a.name, b.name) || byCodeUnit(a.version, b.version),
  )
  const own = { spdx: 'GPL-3.0-only', text: store(readFileSync(join(REPO, 'LICENSE.md'), 'utf8')) }
  const sortedTexts = Object.fromEntries([...texts].sort(([a], [b]) => byCodeUnit(a, b)))
  return `${JSON.stringify({ redextape: own, packages, texts: sortedTexts }, null, 2)}\n`
}

if (import.meta.main) {
  const json = generate()
  if (process.argv.includes('--stdout')) process.stdout.write(json)
  else writeFileSync(OUT, json)
}
