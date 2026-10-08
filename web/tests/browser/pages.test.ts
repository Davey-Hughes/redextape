import { describe, expect, it } from 'vitest'
import { buildOf } from '../../src/build-info'
import { GROUPS, type Licences, renderLicences } from '../../src/licences-page'
import { initPage } from '../../src/pages'
import data from '../../src/third-party-licences.json'

/** Each page's footer, as `about.html` and its siblings write it before `initPage` runs. */
const FOOTER = `
  <footer class="page-foot">
    <span data-copyright>© 2026 Davey Hughes</span> · <span data-build>dev build</span> ·
    <a data-source href="https://github.com/Davey-Hughes/redextape">source</a>
  </footer>`

const fixture = (markup: string): HTMLElement => {
  const root = document.createElement('div')
  root.innerHTML = markup
  return root
}

describe('initPage', () => {
  it("writes the copyright year from the viewer's clock, and the build and its source link", () => {
    const root = fixture(FOOTER)
    initPage(root, new Date(2031, 5, 15), buildOf('8dc603d0'))
    expect(root.querySelector('[data-copyright]')?.textContent).toBe('© 2026–2031 Davey Hughes')
    expect(root.querySelector('[data-build]')?.textContent).toBe('build 8dc603d')
    expect(root.querySelector<HTMLAnchorElement>('a[data-source]')?.href).toBe(
      'https://github.com/Davey-Hughes/redextape/tree/8dc603d0',
    )
  })

  it('fills every marked element, not only the first', () => {
    const root = fixture(`${FOOTER}<p><span data-copyright></span><span data-build></span></p>`)
    initPage(root, new Date(2026, 0, 1), buildOf(undefined))
    expect([...root.querySelectorAll('[data-copyright]')].map((e) => e.textContent)).toEqual([
      '© 2026 Davey Hughes',
      '© 2026 Davey Hughes',
    ])
    expect([...root.querySelectorAll('[data-build]')].map((e) => e.textContent)).toEqual(['dev build', 'dev build'])
  })
})

describe('renderLicences', () => {
  const licences = data as Licences
  const page = (): HTMLElement => {
    const root = fixture('<div id="own-licence"><p>no script</p></div><div id="notices"><p>no script</p></div>')
    renderLicences(root, licences)
    return root
  }

  it("draws redextape's own licence text in place of the no-script note", () => {
    const own = page().querySelector('#own-licence') as HTMLElement
    expect(own.textContent).not.toContain('no script')
    expect(own.querySelector('pre')?.textContent).toBe(licences.texts[licences.redextape.text])
    expect(own.querySelector('pre')?.textContent).toContain('GNU GENERAL PUBLIC LICENSE')
  })

  it('draws a section per group, in order, each holding every package of that group', () => {
    const sections = [...page().querySelectorAll<HTMLElement>('#notices > section')]
    expect(sections.map((s) => s.dataset.group)).toEqual(GROUPS.map(([g]) => g))
    for (const s of sections) {
      const expected = licences.packages.filter((p) => p.group === s.dataset.group).map((p) => `${p.name}@${p.version}`)
      expect(expected.length).toBeGreaterThan(0)
      expect([...s.querySelectorAll<HTMLElement>('details')].map((d) => d.dataset.package)).toEqual(expected)
      expect(s.querySelector('h3')?.textContent).toMatch(new RegExp(`\\(${expected.length}\\)$`))
    }
  })

  it('draws each package with its version, licence, link and every licence text it carries', () => {
    const root = page()
    for (const p of licences.packages) {
      const d = root.querySelector<HTMLElement>(`details[data-package="${p.name}@${p.version}"]`) as HTMLElement
      const named = p.version === '' ? p.name : `${p.name} ${p.version}`
      expect(d.querySelector('summary')?.textContent).toBe(`${named} — ${p.spdx}`)
      expect(d.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe(p.url)
      expect([...d.querySelectorAll('pre')].map((pre) => pre.textContent)).toEqual(
        p.files.map((f) => licences.texts[f.text]),
      )
    }
  })

  it('puts a licence text in as text, never as markup', () => {
    const hostile: Licences = {
      redextape: { spdx: 'GPL-3.0-only', text: 'a' },
      packages: [
        {
          name: 'x',
          version: '1',
          spdx: 'MIT',
          group: 'code',
          url: 'https://x',
          files: [{ file: 'LICENSE', text: 'b' }],
        },
      ],
      texts: { a: 'own', b: '<img src=x onerror="throw 1"><b>bold</b>' },
    }
    const root = fixture('<div id="own-licence"></div><div id="notices"></div>')
    renderLicences(root, hostile)
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('#notices pre')?.textContent).toBe('<img src=x onerror="throw 1"><b>bold</b>')
  })

  it('names a toolchain runtime without a version', () => {
    const std = licences.packages.find((p) => p.group === 'toolchain' && p.name === 'The Rust standard library')
    expect(std?.version).toBe('')
    const d = page().querySelector(`details[data-package="The Rust standard library@"] summary`)
    expect(d?.textContent).toBe('The Rust standard library — MIT OR Apache-2.0')
  })

  it('refuses a package in a group it has no section for, rather than dropping it', () => {
    const stray = { ...licences, packages: [{ ...(licences.packages[0] as Licences['packages'][number]), group: 'x' }] }
    expect(() => renderLicences(fixture('<div id="notices"></div>'), stray as unknown as Licences)).toThrow(
      /no section/,
    )
  })

  it('refuses a file naming a text it does not hold', () => {
    const broken: Licences = { ...licences, texts: {} }
    expect(() => renderLicences(fixture('<div id="own-licence"></div>'), broken)).toThrow(/does not hold/)
  })
})
