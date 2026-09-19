import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// Vite copies `public/` into the site as-is, so these are the licence texts a visitor can reach at
// `/licenses/…`. They are committed copies; this holds each to the installed package's own, so a version
// bump that changes a licence fails here instead of shipping the old text. Hack's is served as `.txt`
// although the package ships `LICENSE.md`: the image's nginx maps no type to `.md`, so it would send the
// file as `application/octet-stream`, which a browser downloads rather than shows.
describe('the font licences the site ships', () => {
  it('match the installed Hack package', () => {
    expect(read('../../public/licenses/hack-LICENSE.txt')).toBe(read('../../node_modules/hack-font/LICENSE.md'))
  })

  it('match the installed Inter package', () => {
    expect(read('../../public/licenses/inter-LICENSE.txt')).toBe(read('../../node_modules/@fontsource/inter/LICENSE'))
  })
})
