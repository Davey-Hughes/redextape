import { describe, expect, it } from 'vitest'
import { readRelative } from './read-fixture'

// Vite copies `public/` into the site as-is, so these are the licence texts a visitor can reach at
// `/licenses/…`. They are committed copies; this holds each to the installed package's own, so a version
// bump that changes a licence fails here instead of shipping the old text. Hack's is served as `.txt`
// although the package ships `LICENSE.md`: the image's nginx maps no type to `.md`, so it would send the
// file as `application/octet-stream`, which a browser downloads rather than shows.
describe('the font licences the site ships', () => {
  it('match the installed Hack package', () => {
    expect(readRelative('../../public/licenses/hack-LICENSE.txt')).toBe(
      readRelative('../../node_modules/hack-font/LICENSE.md'),
    )
  })

  it('match the installed Inter package', () => {
    expect(readRelative('../../public/licenses/inter-LICENSE.txt')).toBe(
      readRelative('../../node_modules/@fontsource/inter/LICENSE'),
    )
  })
})
