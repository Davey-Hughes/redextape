import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LINK_KEY } from '../../src/link-wiring'
import { navKeymap } from '../../src/lsp-nav'

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** The four pages beside the app (about pages design §4), each as the build reads it. */
const PAGES = ['about', 'help', 'licences', 'privacy'] as const
const html = (name: string): string => read(`../../${name}.html`)

/** The `data-key` of every row in `#id`'s table on `page`. */
function tableKeys(page: string, id: string): string[] {
  const table = new RegExp(`<table id="${id}">([\\s\\S]*?)</table>`).exec(html(page))?.[1]
  if (table === undefined) throw new Error(`${page}.html has no table #${id}`)
  return [...table.matchAll(/<tr data-key="([^"]+)">/g)].map((m) => m[1] ?? '')
}

describe('the pages beside the app', () => {
  /** Each page links the other three and itself, in one order, marking its own as the current page. */
  it.each(PAGES)('%s.html carries the shared nav, marking itself', (name) => {
    const nav = /<nav class="page-nav" aria-label="pages">([\s\S]*?)<\/nav>/.exec(html(name))?.[1] ?? ''
    expect([...nav.matchAll(/href="\/([a-z]+)\.html"/g)].map((m) => m[1])).toEqual([...PAGES])
    expect([...nav.matchAll(/href="\/([a-z]+)\.html" aria-current="page"/g)].map((m) => m[1])).toEqual([name])
  })

  /** What `pages.ts`'s `initPage` fills: the copyright line, the build and the source link. */
  it.each(PAGES)('%s.html has the shared footer, with the copyright year as the HTML writes it', (name) => {
    const foot = /<footer class="page-foot">([\s\S]*?)<\/footer>/.exec(html(name))?.[1] ?? ''
    expect(foot).toContain('<span data-copyright>© 2026 Davey Hughes</span>')
    expect(foot).toContain('<span data-build>dev build</span>')
    expect(foot).toContain('<a data-source href="https://github.com/Davey-Hughes/redextape">source</a>')
    expect(html(name)).toMatch(/import \{ initPage \} from '\/src\/pages\.ts'/)
  })
})

describe('the help page', () => {
  /**
   * **THE EDITOR TABLE IS THE EDITORS' OWN BINDINGS, NO MORE AND NO FEWER**: every key `navKeymap` binds in every
   * editor, and the source editor's `LINK_KEY`. A key added to either without a row, or a row left behind by a
   * removed key, fails here.
   */
  it("lists exactly the app's own editor keys", () => {
    const nav = navKeymap({ uri: () => undefined, client: () => undefined, reveal: () => {}, notify: () => {} })
    const bound = [...nav.map((b) => b.key ?? ''), LINK_KEY]
    expect(tableKeys('help', 'editor-keys').sort()).toEqual(bound.sort())
  })

  /**
   * **EACH ROW SHOWS THE KEY IT IS FILED UNDER.** The test above reads only `data-key`; this reads the keys a reader
   * sees — the row's first cell, before any parenthesised alternative — and spells them as CodeMirror does, with
   * `Mod` shown as `Ctrl`.
   */
  it('shows each row the key it is filed under', () => {
    const table = /<table id="editor-keys">([\s\S]*?)<\/table>/.exec(html('help'))?.[1] ?? ''
    const rows = [...table.matchAll(/<tr data-key="([^"]+)"><td>([\s\S]*?)<\/td>/g)]
    expect(rows.length).toBe(tableKeys('help', 'editor-keys').length)
    for (const [, key, cell] of rows) {
      const before = (cell ?? '').split(' (')[0] ?? ''
      const shown = [...before.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1]).join('-')
      expect(shown, key).toBe((key ?? '').replace(/^Mod-/, 'Ctrl-'))
    }
  })
})

describe('the privacy page', () => {
  /**
   * Every `.ts` file under `src/`, read from disk so a file not yet added to git is read too, with its comments
   * blanked — prose names keys too (`redextape.*`), and a key in a comment is stored nowhere.
   */
  const sources = (): string[] => {
    const src = fileURLToPath(new URL('../../src/', import.meta.url))
    return (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts'))
      .map((f) =>
        readFileSync(join(src, f), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1'),
      )
  }

  /**
   * **EVERY KEY THE APP STORES, AND ONLY THOSE**: the `redextape.*` string literals in `src/`, in any quotes and
   * spelt with any characters a key may hold, so a key declared in a new file is counted too. A key built in a
   * template could hold any name, so there may be none. The page's claim that this is the whole list rests on it.
   */
  it('lists every redextape.* storage key the app declares', () => {
    const code = sources()
    expect(code.join('\n')).not.toMatch(/`redextape\.[^`]*\$\{/)
    const keys = [
      ...new Set(code.flatMap((c) => [...c.matchAll(/['"`](redextape\.[^'"`$\s]+)['"`]/g)].map((m) => m[1] ?? ''))),
    ]
    expect(keys.length).toBeGreaterThan(0)
    expect(tableKeys('privacy', 'storage-keys').sort()).toEqual(keys.sort())
  })

  it('names no other store the app could keep things in', () => {
    const all = sources().join('\n')
    for (const api of [
      /sessionStorage/,
      /indexedDB/,
      /document\.cookie/,
      /cookieStore/,
      /\bcaches\./,
      /serviceWorker/,
    ]) {
      expect(all).not.toMatch(api)
    }
  })
})
