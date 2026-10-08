import data from './third-party-licences.json'

/**
 * THE LICENCES PAGE'S LIST — about pages design §4 and §8. `third-party-licences.json` is written by
 * `scripts/licences.ts` and held to the lockfiles by `scripts/check-licences.sh`; this draws it: redextape's own
 * licence text, then every shipped package, grouped by where it ships, each a `<details>` holding its licence texts.
 *
 * Every text goes in through `textContent`, never as markup: a licence file is the package's own and is not this
 * site's to trust.
 */

/** Where a package ships, as `scripts/licences.ts` records it. */
export type Group = 'code' | 'wasm' | 'toolchain' | 'font'

/** The shape `scripts/licences.ts` writes. A text is stored once and named by its id wherever it is carried. */
export type Licences = {
  readonly redextape: { readonly spdx: string; readonly text: string }
  readonly packages: readonly {
    readonly name: string
    readonly version: string
    readonly spdx: string
    readonly group: Group
    readonly url: string
    readonly files: readonly { readonly file: string; readonly text: string }[]
  }[]
  readonly texts: Readonly<Record<string, string>>
}

/** The page's sections, in its order. */
export const GROUPS: readonly (readonly [Group, string])[] = [
  ['code', "In the page's code"],
  ['wasm', 'In the WebAssembly'],
  ['toolchain', 'From the toolchains'],
  ['font', 'Fonts'],
]

function textOf(licences: Licences, id: string): string {
  const text = licences.texts[id]
  if (text === undefined) throw new Error(`third-party-licences.json names a text it does not hold: ${id}`)
  return text
}

function pre(text: string): HTMLPreElement {
  const el = document.createElement('pre')
  el.textContent = text
  return el
}

/**
 * Fill `#own-licence` with redextape's licence text and `#notices` with a section per group, replacing what the
 * static page holds there for a reader without JavaScript.
 */
export function renderLicences(root: ParentNode = document, licences: Licences = data as Licences): void {
  const own = root.querySelector('#own-licence')
  if (own !== null) {
    const d = document.createElement('details')
    const s = document.createElement('summary')
    s.textContent = `The licence text (${licences.redextape.spdx})`
    d.append(s, pre(textOf(licences, licences.redextape.text)))
    own.replaceChildren(d)
  }
  const notices = root.querySelector('#notices')
  if (notices === null) return
  // A GROUP THE PAGE DOES NOT DRAW WOULD DROP ITS PACKAGES SILENTLY — the defect this list exists to prevent.
  for (const p of licences.packages) {
    if (!GROUPS.some(([g]) => g === p.group)) throw new Error(`${p.name} is in a group the page has no section for`)
  }
  notices.replaceChildren(
    ...GROUPS.map(([group, heading]) => {
      const section = document.createElement('section')
      section.dataset.group = group
      const h = document.createElement('h3')
      const members = licences.packages.filter((p) => p.group === group)
      h.textContent = `${heading} (${members.length})`
      section.append(
        h,
        ...members.map((p) => {
          const d = document.createElement('details')
          d.dataset.package = `${p.name}@${p.version}`
          const s = document.createElement('summary')
          // A TOOLCHAIN'S RUNTIME HAS NO VERSION: it is whatever the toolchain in use compiles in.
          s.textContent = p.version === '' ? `${p.name} — ${p.spdx}` : `${p.name} ${p.version} — ${p.spdx}`
          const meta = document.createElement('p')
          meta.className = 'meta'
          const a = document.createElement('a')
          a.href = p.url
          a.textContent = p.url
          meta.append(a)
          d.append(s, meta)
          for (const f of p.files) {
            const name = document.createElement('p')
            name.className = 'meta'
            name.textContent = f.file
            d.append(name, pre(textOf(licences, f.text)))
          }
          return d
        }),
      )
      return section
    }),
  )
}
