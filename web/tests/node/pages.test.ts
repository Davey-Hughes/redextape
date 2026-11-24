import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CYCLE } from '../../src/arrangements'
import { KIND_WORD } from '../../src/layout'
import { LINK_KEY } from '../../src/link-wiring'
import { navKeymap } from '../../src/lsp-nav'
import { HINT_ROWS, PREFIX, PREFIX_LABEL, VIEW_KEYS } from '../../src/view-keys'
import { readRelative } from './read-fixture'

/** The four pages beside the app (about pages design §4), each as the build reads it. */
const PAGES = ['about', 'help', 'licences', 'privacy'] as const
const html = (name: string): string => readRelative(`../../${name}.html`)

/**
 * The `data-key` of every row in `#id`'s table on `page`.
 *
 * **EVERY ROW OF THE BODY HAS ONE, OR THIS THROWS.** The tests below hold a table to a list by its rows' keys, and a
 * row written with no `data-key` would be a row none of them read: the page could list a key the app does not have.
 */
function tableKeys(page: string, id: string): string[] {
  const table = new RegExp(`<table id="${id}">([\\s\\S]*?)</table>`).exec(html(page))?.[1]
  if (table === undefined) throw new Error(`${page}.html has no table #${id}`)
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(table)?.[1]
  if (body === undefined) throw new Error(`${page}.html's table #${id} has no body`)
  const keys = [...body.matchAll(/<tr data-key="([^"]+)">/g)].map((m) => m[1] ?? '')
  const rows = [...body.matchAll(/<tr[\s>]/g)].length
  if (rows !== keys.length)
    throw new Error(`${page}.html's table #${id} has ${rows} rows, and ${keys.length} of them have a data-key`)
  return keys
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
   * **THE EDITOR TABLE IS THE SOURCE EDITOR'S OWN BINDINGS, NO MORE AND NO FEWER**: every key `navKeymap` binds, and
   * `LINK_KEY`. A key added to either without a row, or a row left behind by a removed key, fails here.
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

  /**
   * **EVERY ROW NAMES THE SOURCE EDITOR AS WHERE ITS KEY WORKS**: it is the one editor the app builds, so a row naming
   * any other place sends a reader looking for an editor that is not there.
   */
  it('names the source editor as where each key works', () => {
    const table = /<table id="editor-keys">([\s\S]*?)<\/table>/.exec(html('help'))?.[1] ?? ''
    const third = /<tr data-key="[^"]+">(?:<td>[\s\S]*?<\/td>){2}<td>([\s\S]*?)<\/td><\/tr>/g
    const where = [...table.matchAll(third)].map((m) => m[1])
    expect(where).toEqual(tableKeys('help', 'editor-keys').map(() => 'the source editor'))
  })

  /**
   * **THE PAGE NAMES THE CHOICE IN THE MENU'S WORDS**, so a reader finds in the settings menu what the page told them
   * to look for. `blur` is the DOM's word for leaving the editor, not a reader's. Whitespace is collapsed, so where
   * the HTML wraps its lines is not a difference.
   */
  it('names the format choice as the settings menu does', () => {
    const words = (s: string) => s.replace(/\s+/g, ' ').trim()
    const label = /<input type="checkbox" id="format-on-blur" \/>([^<]+)<\/label>/.exec(html('index'))?.[1]
    expect(label, 'index.html has the format checkbox’s label').toMatch(/\S/)
    const page = words(html('help'))
    expect(page).toContain(words(label as string))
    expect(page).not.toMatch(/blur/i)
  })
})

describe('the help page’s view keys', () => {
  /**
   * **THE TABLE IS `view-keys.ts`'s OWN**: every key an armed machine answers, with the words the page's hint gives
   * it, in the hint's order. A key added to the machine without a row, a row left behind, or a row whose words have
   * drifted from the hint's, fails here.
   */
  it('lists exactly the keys the machine answers, each with the hint’s words', () => {
    const table = /<table id="view-keys">([\s\S]*?)<\/table>/.exec(html('help'))?.[1] ?? ''
    const rows = [...table.matchAll(/<tr data-key="([^"]+)"><td><kbd>([^<]+)<\/kbd><\/td><td>([^<]+)<\/td><\/tr>/g)]
    expect(rows.map(([, key, shown, does]) => [key, shown, does])).toEqual(VIEW_KEYS.map((r) => [r.key, r.key, r.does]))
    // AND NO ROW THE PATTERN ABOVE DOES NOT READ: `tableKeys` throws on one with no `data-key`.
    expect(tableKeys('help', 'view-keys')).toEqual(VIEW_KEYS.map((r) => r.key))
  })

  it('names the prefix as the machine has it', () => {
    const says = /<p id="view-keys-prefix">([\s\S]*?)<\/p>/.exec(html('help'))?.[1] ?? ''
    const shown = [...(says.split(' and then')[0] ?? '').matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1]).join('+')
    expect(shown).toBe(PREFIX_LABEL)
    expect(PREFIX_LABEL).toBe(`${PREFIX.ctrl ? 'Ctrl+' : ''}${PREFIX.key}`)
  })

  /** A paragraph of the help page as a reader has it: its tags gone, and each run of white space one space. */
  const prose = (id: string): string =>
    (new RegExp(`<p id="${id}">([\\s\\S]*?)</p>`).exec(html('help'))?.[1] ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()

  /**
   * **BOTH WAYS OUT, AS THE HINT LISTS THEM**: the hint's last row is `Esc`, *or `Ctrl+.` leave*. The machine's own
   * test for them is in `tests/node/view-keys.test.ts`:
   * `leaves on Escape and on the prefix again, consuming both and doing nothing`.
   */
  it('says both ways out of the mode: the hint’s key, and the prefix again', () => {
    expect(HINT_ROWS.at(-1)?.does).toBe(`or ${PREFIX_LABEL} leave`)
    expect(prose('view-keys-prefix')).toMatch(
      new RegExp(
        ` and ${HINT_ROWS.at(-1)?.key}, or ${PREFIX_LABEL.replace(/[+.]/g, '\\$&')} again, leaves without doing anything\\.$`,
      ),
    )
  })

  /**
   * **THE STOPS ARE `arrangements.ts`'s `CYCLE`, IN ITS ORDER**: the source beside each other kind the cycle holds, by
   * the kind's own word, and then its last stop, all of those kinds, by their count.
   */
  it('lists the layouts the cycle keys step through, in the cycle’s order', () => {
    // `help.html` SPELLS THE LAST STOP'S COUNT AS A WORD, AND ONLY THIS COUNT HAS ONE: a last stop of another size
    // fails here until its sentence is rewritten.
    const countWord: Readonly<Record<number, string>> = { 4: 'four' }
    const stops = CYCLE.map((stop) =>
      stop === CYCLE.at(-1) ? `all ${countWord[stop.length]}` : stop.map((kind) => KIND_WORD[kind]).join(' beside '),
    )
    expect(stops.slice(0, -1).every((stop) => stop.startsWith('source beside '))).toBe(true)
    expect(prose('view-keys-cycle')).toBe(
      `The layouts ] and [ step through are ${stops
        .slice(0, -1)
        .map((stop) => `the ${stop}`)
        .join(', ')}, and ${stops.at(-1)}.`,
    )
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
